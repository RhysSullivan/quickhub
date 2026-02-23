/**
 * onDemandSync — On-demand sync for individual PRs, issues, and repos.
 *
 * When a user deep-links to a PR/issue page that hasn't been synced yet,
 * this module fetches just that entity from GitHub and writes it to the DB
 * (rather than triggering a full repo bootstrap).
 *
 * Flow for PR:
 *   1. Look up (or create) the repo record
 *   2. Fetch the single PR from GitHub API
 *   3. Fetch PR timeline comments, reviews, review comments, check runs
 *   4. Upsert all data + users
 *   5. Schedule syncPrFiles for diff data
 *   6. Update projections
 *
 * Flow for Issue:
 *   1. Look up (or create) the repo record
 *   2. Fetch the single issue from GitHub API
 *   3. Fetch issue comments
 *   4. Upsert all data + users
 *   5. Update projections
 */
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Array as Arr, Effect, Option, Predicate, Schema } from "effect";
import { internal } from "../_generated/api";
import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	confectSchema,
} from "../confect";
import { toOpenClosedState } from "../shared/coerce";
import type { SimpleUser } from "../shared/generated_github_client";
import { GitHubApiClient } from "../shared/githubApi";
import { getInstallationToken } from "../shared/githubApp";
import { parseIsoToMsOrNull as isoToMs } from "../shared/time";
import { DatabaseRpcModuleMiddlewares } from "./moduleMiddlewares";
import {
	ReadGitHubRepoByNameMiddleware,
	ReadGitHubRepoPermission,
} from "./security";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class EntityNotFound extends Schema.TaggedError<EntityNotFound>()(
	"EntityNotFound",
	{
		ownerLogin: Schema.String,
		name: Schema.String,
		entityType: Schema.Literal("pull_request", "issue"),
		number: Schema.Number,
	},
) {}

class RepoNotFoundOnGitHub extends Schema.TaggedError<RepoNotFoundOnGitHub>()(
	"RepoNotFoundOnGitHub",
	{ ownerLogin: Schema.String, name: Schema.String },
) {}

// ---------------------------------------------------------------------------
// ISO date string → millisecond timestamp helper
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Typed user collector
// ---------------------------------------------------------------------------

/** The subset of SimpleUser / NullableSimpleUser fields the collector reads. */
type GitHubUser = Pick<
	typeof SimpleUser.Type,
	"id" | "login" | "avatar_url" | "site_admin" | "type"
>;

const toUserType = (t: string): "User" | "Bot" | "Organization" =>
	t === "Bot" ? "Bot" : t === "Organization" ? "Organization" : "User";

const createUserCollector = () => {
	const userMap = new Map<number, ReturnType<typeof makeUserRecord>>();

	const makeUserRecord = (u: GitHubUser) => ({
		githubUserId: u.id,
		login: u.login,
		avatarUrl: u.avatar_url,
		siteAdmin: u.site_admin,
		type: toUserType(u.type),
	});

	const collect = (u: GitHubUser | null | undefined): number | null => {
		if (u == null) return null;
		if (!userMap.has(u.id)) {
			userMap.set(u.id, makeUserRecord(u));
		}
		return u.id;
	};

	const getUsers = () => [...userMap.values()];

	return { collect, getUsers };
};

const resolveAuthorizedSyncRepo = (
	ownerLogin: string,
	name: string,
	entityType: "pull_request" | "issue",
	number: number,
	permission: {
		isAllowed: boolean;
		reason:
			| "allowed"
			| "repo_not_found"
			| "not_authenticated"
			| "insufficient_permission"
			| "invalid_payload"
			| "invalid_repo_info";
		repository: {
			repositoryId: number;
			installationId: number;
		} | null;
	},
) =>
	Effect.gen(function* () {
		if (!permission.isAllowed || permission.repository === null) {
			if (permission.reason === "repo_not_found") {
				return yield* new RepoNotFoundOnGitHub({ ownerLogin, name });
			}

			return yield* new EntityNotFound({
				ownerLogin,
				name,
				entityType,
				number,
			});
		}

		if (permission.repository.installationId <= 0) {
			return yield* new RepoNotFoundOnGitHub({ ownerLogin, name });
		}

		return {
			repositoryId: permission.repository.repositoryId,
			installationId: permission.repository.installationId,
		};
	});

// ---------------------------------------------------------------------------
// Internal mutation: ensure repo exists, return repositoryId
// ---------------------------------------------------------------------------

const ensureRepoDef = factory.internalMutation({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		/** Repo metadata from GitHub — only provided if repo doesn't exist yet */
		repoData: Schema.optional(
			Schema.Struct({
				githubRepoId: Schema.Number,
				ownerId: Schema.Number,
				defaultBranch: Schema.String,
				visibility: Schema.Literal("public", "private", "internal"),
				isPrivate: Schema.Boolean,
				fullName: Schema.String,
				stargazersCount: Schema.optional(Schema.Number),
			}),
		),
	},
	success: Schema.NullOr(
		Schema.Struct({
			repositoryId: Schema.Number,
			alreadyExists: Schema.Boolean,
		}),
	),
});

ensureRepoDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		// Check if repo already exists
		const existing = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isSome(existing)) {
			return {
				repositoryId: existing.value.githubRepoId,
				alreadyExists: true,
			};
		}

		// If repo doesn't exist and we have no data to create it, return null
		if (args.repoData === undefined) return null;

		const now = Date.now();
		const repoData = args.repoData;

		// Find or create installation record
		const existingInstallation = yield* ctx.db
			.query("github_installations")
			.withIndex("by_accountLogin", (q) =>
				q.eq("accountLogin", args.ownerLogin),
			)
			.first();

		const installationId = Option.isSome(existingInstallation)
			? existingInstallation.value.installationId
			: 0;

		if (Option.isNone(existingInstallation)) {
			yield* ctx.db.insert("github_installations", {
				installationId: 0,
				accountId: repoData.ownerId,
				accountLogin: args.ownerLogin,
				accountType: "User",
				suspendedAt: null,
				permissionsDigest: "",
				eventsDigest: "",
				updatedAt: now,
			});
		}

		// Create repository record
		yield* ctx.db.insert("github_repositories", {
			githubRepoId: repoData.githubRepoId,
			installationId,
			ownerId: repoData.ownerId,
			ownerLogin: args.ownerLogin,
			name: args.name,
			fullName: repoData.fullName,
			private: repoData.isPrivate,
			visibility: repoData.visibility,
			defaultBranch: repoData.defaultBranch,
			archived: false,
			disabled: false,
			fork: false,
			pushedAt: null,
			githubUpdatedAt: now,
			cachedAt: now,
			connectedByUserId: null,
			stargazersCount: repoData.stargazersCount ?? 0,
		});

		return {
			repositoryId: repoData.githubRepoId,
			alreadyExists: false,
		};
	}),
);

// ---------------------------------------------------------------------------
// Internal mutation: upsert a single PR's comments + reviews
// ---------------------------------------------------------------------------

const upsertPrCommentsDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		prNumber: Schema.Number,
		comments: Schema.Array(
			Schema.Struct({
				githubCommentId: Schema.Number,
				authorUserId: Schema.NullOr(Schema.Number),
				body: Schema.String,
				createdAt: Schema.Number,
				updatedAt: Schema.Number,
			}),
		),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

upsertPrCommentsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		let upserted = 0;

		for (const comment of args.comments) {
			const existing = yield* ctx.db
				.query("github_issue_comments")
				.withIndex("by_repositoryId_and_githubCommentId", (q) =>
					q
						.eq("repositoryId", args.repositoryId)
						.eq("githubCommentId", comment.githubCommentId),
				)
				.first();

			const data = {
				repositoryId: args.repositoryId,
				issueNumber: args.prNumber,
				githubCommentId: comment.githubCommentId,
				authorUserId: comment.authorUserId,
				body: comment.body,
				createdAt: comment.createdAt,
				updatedAt: comment.updatedAt,
			};

			if (Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, data);
			} else {
				yield* ctx.db.insert("github_issue_comments", data);
			}
			upserted++;
		}

		return { upserted };
	}),
);

// ---------------------------------------------------------------------------
// Internal mutation: upsert PR reviews
// ---------------------------------------------------------------------------

const upsertPrReviewsDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		prNumber: Schema.Number,
		reviews: Schema.Array(
			Schema.Struct({
				githubReviewId: Schema.Number,
				authorUserId: Schema.NullOr(Schema.Number),
				state: Schema.String,
				submittedAt: Schema.NullOr(Schema.Number),
				commitSha: Schema.NullOr(Schema.String),
			}),
		),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

upsertPrReviewsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		let upserted = 0;

		for (const review of args.reviews) {
			const existing = yield* ctx.db
				.query("github_pull_request_reviews")
				.withIndex("by_repositoryId_and_githubReviewId", (q) =>
					q
						.eq("repositoryId", args.repositoryId)
						.eq("githubReviewId", review.githubReviewId),
				)
				.first();

			const data = {
				repositoryId: args.repositoryId,
				pullRequestNumber: args.prNumber,
				githubReviewId: review.githubReviewId,
				authorUserId: review.authorUserId,
				state: review.state,
				submittedAt: review.submittedAt,
				commitSha: review.commitSha,
			};

			if (Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, data);
			} else {
				yield* ctx.db.insert("github_pull_request_reviews", data);
			}
			upserted++;
		}

		return { upserted };
	}),
);

// ---------------------------------------------------------------------------
// Internal mutation: upsert PR review comments (inline comments)
// ---------------------------------------------------------------------------

const upsertPrReviewCommentsDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		prNumber: Schema.Number,
		reviewComments: Schema.Array(
			Schema.Struct({
				githubReviewCommentId: Schema.Number,
				githubReviewId: Schema.NullOr(Schema.Number),
				inReplyToGithubReviewCommentId: Schema.NullOr(Schema.Number),
				authorUserId: Schema.NullOr(Schema.Number),
				body: Schema.String,
				path: Schema.NullOr(Schema.String),
				line: Schema.NullOr(Schema.Number),
				originalLine: Schema.NullOr(Schema.Number),
				startLine: Schema.NullOr(Schema.Number),
				side: Schema.NullOr(Schema.String),
				startSide: Schema.NullOr(Schema.String),
				commitSha: Schema.NullOr(Schema.String),
				originalCommitSha: Schema.NullOr(Schema.String),
				htmlUrl: Schema.NullOr(Schema.String),
				createdAt: Schema.Number,
				updatedAt: Schema.Number,
			}),
		),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

upsertPrReviewCommentsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		let upserted = 0;

		for (const reviewComment of args.reviewComments) {
			const existing = yield* ctx.db
				.query("github_pull_request_review_comments")
				.withIndex("by_repositoryId_and_githubReviewCommentId", (q) =>
					q
						.eq("repositoryId", args.repositoryId)
						.eq("githubReviewCommentId", reviewComment.githubReviewCommentId),
				)
				.first();

			const data = {
				repositoryId: args.repositoryId,
				pullRequestNumber: args.prNumber,
				githubReviewCommentId: reviewComment.githubReviewCommentId,
				githubReviewId: reviewComment.githubReviewId,
				inReplyToGithubReviewCommentId:
					reviewComment.inReplyToGithubReviewCommentId,
				authorUserId: reviewComment.authorUserId,
				body: reviewComment.body,
				path: reviewComment.path,
				line: reviewComment.line,
				originalLine: reviewComment.originalLine,
				startLine: reviewComment.startLine,
				side: reviewComment.side,
				startSide: reviewComment.startSide,
				commitSha: reviewComment.commitSha,
				originalCommitSha: reviewComment.originalCommitSha,
				htmlUrl: reviewComment.htmlUrl,
				createdAt: reviewComment.createdAt,
				updatedAt: reviewComment.updatedAt,
			};

			if (Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, data);
			} else {
				yield* ctx.db.insert("github_pull_request_review_comments", data);
			}
			upserted++;
		}

		return { upserted };
	}),
);

// ---------------------------------------------------------------------------
// Internal mutation: write data + update projections
// ---------------------------------------------------------------------------

const writeAndProjectDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
	},
	success: Schema.Struct({ ok: Schema.Boolean }),
});

writeAndProjectDef.implement(() =>
	// Materialized projections have been removed.
	// This endpoint is kept for backward compatibility (callers still reference it).
	Effect.succeed({ ok: true }),
);

// ---------------------------------------------------------------------------
// Internal query: check if entity already exists
// ---------------------------------------------------------------------------

const checkEntityExistsDef = factory.internalQuery({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		entityType: Schema.Literal("pull_request", "issue"),
		number: Schema.Number,
	},
	success: Schema.Boolean,
});

checkEntityExistsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		// First find the repo
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isNone(repo)) return false;
		const repositoryId = repo.value.githubRepoId;

		if (args.entityType === "pull_request") {
			const pr = yield* ctx.db
				.query("github_pull_requests")
				.withIndex("by_repositoryId_and_number", (q) =>
					q.eq("repositoryId", repositoryId).eq("number", args.number),
				)
				.first();
			return Option.isSome(pr);
		}

		const issue = yield* ctx.db
			.query("github_issues")
			.withIndex("by_repositoryId_and_number", (q) =>
				q.eq("repositoryId", repositoryId).eq("number", args.number),
			)
			.first();
		return Option.isSome(issue);
	}),
);

// ---------------------------------------------------------------------------
// Public action: syncPullRequest — fetch and write a single PR
// ---------------------------------------------------------------------------

const syncPullRequestDef = factory
	.action({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			number: Schema.Number,
			force: Schema.optional(Schema.Boolean),
		},
		success: Schema.Struct({
			synced: Schema.Boolean,
			repositoryId: Schema.Number,
		}),
		error: Schema.Union(EntityNotFound, RepoNotFoundOnGitHub),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

syncPullRequestDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const permission = yield* ReadGitHubRepoPermission;
		const { repositoryId, installationId } = yield* resolveAuthorizedSyncRepo(
			args.ownerLogin,
			args.name,
			"pull_request",
			args.number,
			permission,
		);

		const token = yield* getInstallationToken(installationId).pipe(
			Effect.mapError(
				() =>
					new RepoNotFoundOnGitHub({
						ownerLogin: args.ownerLogin,
						name: args.name,
					}),
			),
		);
		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);
		const users = createUserCollector();

		// 1. Return early when the entity already exists
		const repoCheck = yield* ctx.runQuery(
			internal.rpc.onDemandSync.checkEntityExists,
			{
				ownerLogin: args.ownerLogin,
				name: args.name,
				entityType: "pull_request",
				number: args.number,
			},
		);

		if (repoCheck === true && args.force !== true) {
			return { synced: false, repositoryId };
		}

		// 2. Fetch the PR from GitHub (typed client)
		const prData = yield* gh.client
			.pullsGet(args.ownerLogin, args.name, String(args.number))
			.pipe(Effect.catchAll(() => Effect.succeed(null)));

		if (prData === null) {
			return yield* new EntityNotFound({
				ownerLogin: args.ownerLogin,
				name: args.name,
				entityType: "pull_request",
				number: args.number,
			});
		}

		const authorUserId = users.collect(prData.user);

		const labelNames = prData.labels.map((label) => label.name);

		const pr = {
			githubPrId: prData.id,
			number: prData.number,
			state: toOpenClosedState(prData.state),
			draft: prData.draft === true,
			title: prData.title,
			body: prData.body ?? null,
			authorUserId,
			assigneeUserIds: [],
			requestedReviewerUserIds: [],
			labelNames,
			baseRefName: prData.base.ref,
			headRefName: prData.head.ref,
			headSha: prData.head.sha,
			mergeableState: prData.mergeable_state ?? null,
			mergedAt: isoToMs(prData.merged_at),
			closedAt: isoToMs(prData.closed_at),
			githubUpdatedAt: isoToMs(prData.updated_at) ?? Date.now(),
		};

		// Upsert the PR
		yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertPullRequests, {
			repositoryId,
			pullRequests: [pr],
		});

		// 4. Fetch comments for this PR (typed client)
		const rawComments = yield* gh.client
			.issuesListComments(args.ownerLogin, args.name, String(args.number), {
				per_page: 100,
			})
			.pipe(Effect.catchAll(() => Effect.succeed([])));

		const comments = rawComments.map((c) => ({
			githubCommentId: c.id,
			authorUserId: users.collect(c.user),
			body: c.body ?? "",
			createdAt: isoToMs(c.created_at) ?? Date.now(),
			updatedAt: isoToMs(c.updated_at) ?? Date.now(),
		}));

		if (comments.length > 0) {
			yield* ctx.runMutation(internal.rpc.onDemandSync.upsertPrComments, {
				repositoryId,
				prNumber: args.number,
				comments,
			});
		}

		// 5. Fetch reviews (typed client)
		const rawReviews = yield* gh.client
			.pullsListReviews(args.ownerLogin, args.name, String(args.number), {
				per_page: 100,
			})
			.pipe(Effect.catchAll(() => Effect.succeed([])));

		const reviews = rawReviews.map((r) => ({
			githubReviewId: r.id,
			authorUserId: users.collect(r.user),
			state: r.state,
			submittedAt: isoToMs(r.submitted_at),
			commitSha: r.commit_id ?? null,
		}));

		if (reviews.length > 0) {
			yield* ctx.runMutation(internal.rpc.onDemandSync.upsertPrReviews, {
				repositoryId,
				prNumber: args.number,
				reviews,
			});
		}

		// 6. Fetch review comments / inline PR comments (typed client)
		const rawReviewComments = yield* gh.client
			.pullsListReviewComments(
				args.ownerLogin,
				args.name,
				String(args.number),
				{ per_page: 100 },
			)
			.pipe(Effect.catchAll(() => Effect.succeed([])));

		const reviewComments = rawReviewComments.map((c) => ({
			githubReviewCommentId: c.id,
			githubReviewId: c.pull_request_review_id ?? null,
			inReplyToGithubReviewCommentId: c.in_reply_to_id ?? null,
			authorUserId: users.collect(c.user),
			body: c.body,
			path: c.path ?? null,
			line: c.line ?? null,
			originalLine: c.original_line ?? null,
			startLine: c.start_line ?? null,
			side: c.side ?? null,
			startSide: c.start_side ?? null,
			commitSha: c.commit_id ?? null,
			originalCommitSha: c.original_commit_id ?? null,
			htmlUrl: c.html_url ?? null,
			createdAt: isoToMs(c.created_at) ?? Date.now(),
			updatedAt: isoToMs(c.updated_at) ?? Date.now(),
		}));

		if (reviewComments.length > 0) {
			yield* ctx.runMutation(internal.rpc.onDemandSync.upsertPrReviewComments, {
				repositoryId,
				prNumber: args.number,
				reviewComments,
			});
		}

		// 7. Fetch check runs for the PR's head SHA (typed client)
		if (pr.headSha !== "") {
			const checkRunsResult = yield* gh.client
				.checksListForRef(args.ownerLogin, args.name, pr.headSha, {
					per_page: 100,
				})
				.pipe(
					Effect.catchAll(() =>
						Effect.succeed({ total_count: 0, check_runs: [] }),
					),
				);

			const checkRuns = checkRunsResult.check_runs.map((cr) => ({
				githubCheckRunId: cr.id,
				name: cr.name,
				headSha: pr.headSha,
				status: cr.status,
				conclusion: cr.conclusion ?? null,
				startedAt: isoToMs(cr.started_at),
				completedAt: isoToMs(cr.completed_at),
			}));

			if (checkRuns.length > 0) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertCheckRuns, {
					repositoryId,
					checkRuns,
				});
			}
		}

		// 8. Upsert collected users
		const allUsers = users.getUsers();
		if (allUsers.length > 0) {
			yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertUsers, {
				users: allUsers,
			});
		}

		// 9. Update projections
		yield* ctx.runMutation(internal.rpc.onDemandSync.writeAndProject, {
			repositoryId,
		});

		// 10. Schedule PR file sync for diff data
		if (pr.headSha !== "") {
			yield* Effect.promise(() =>
				ctx.scheduler.runAfter(0, internal.rpc.githubActions.syncPrFiles, {
					ownerLogin: args.ownerLogin,
					name: args.name,
					repositoryId,
					pullRequestNumber: args.number,
					headSha: pr.headSha,
					installationId,
				}),
			);
		}

		return { synced: true, repositoryId };
	}),
);

// ---------------------------------------------------------------------------
// Public action: syncIssue — fetch and write a single issue
// ---------------------------------------------------------------------------

const syncIssueDef = factory
	.action({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			number: Schema.Number,
		},
		success: Schema.Struct({
			synced: Schema.Boolean,
			repositoryId: Schema.Number,
		}),
		error: Schema.Union(EntityNotFound, RepoNotFoundOnGitHub),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

syncIssueDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const permission = yield* ReadGitHubRepoPermission;
		const { repositoryId, installationId } = yield* resolveAuthorizedSyncRepo(
			args.ownerLogin,
			args.name,
			"issue",
			args.number,
			permission,
		);

		const token = yield* getInstallationToken(installationId).pipe(
			Effect.mapError(
				() =>
					new RepoNotFoundOnGitHub({
						ownerLogin: args.ownerLogin,
						name: args.name,
					}),
			),
		);
		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);
		const userCollector = createUserCollector();

		// 1. Check if entity already exists
		const entityExists = yield* ctx.runQuery(
			internal.rpc.onDemandSync.checkEntityExists,
			{
				ownerLogin: args.ownerLogin,
				name: args.name,
				entityType: "issue",
				number: args.number,
			},
		);

		if (entityExists === true) {
			return { synced: false, repositoryId };
		}

		// 2. Fetch the issue from GitHub (typed client)
		// issuesGet returns Issue | BasicError. Narrow via "id".
		const issueResult = yield* gh.client
			.issuesGet(args.ownerLogin, args.name, String(args.number))
			.pipe(Effect.catchAll(() => Effect.succeed(null)));

		if (issueResult === null || !("id" in issueResult)) {
			return yield* new EntityNotFound({
				ownerLogin: args.ownerLogin,
				name: args.name,
				entityType: "issue",
				number: args.number,
			});
		}

		// GitHub's issues API also returns PRs — check if this is actually a PR
		const isPullRequest = issueResult.pull_request !== undefined;

		const authorUserId = userCollector.collect(issueResult.user);

		const labels = Arr.filter(
			Arr.map(issueResult.labels, (label) =>
				typeof label === "string" ? label : (label.name ?? null),
			),
			Predicate.isNotNull,
		);

		const issue = {
			githubIssueId: issueResult.id,
			number: issueResult.number,
			state: toOpenClosedState(issueResult.state),
			title: issueResult.title,
			body: issueResult.body ?? null,
			authorUserId,
			assigneeUserIds: [],
			labelNames: labels,
			commentCount: issueResult.comments,
			isPullRequest,
			closedAt: isoToMs(issueResult.closed_at),
			githubUpdatedAt: isoToMs(issueResult.updated_at) ?? Date.now(),
		};

		// Upsert the issue
		yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertIssues, {
			repositoryId,
			issues: [issue],
		});

		// 4. Fetch comments (typed client)
		const rawComments = yield* gh.client
			.issuesListComments(args.ownerLogin, args.name, String(args.number), {
				per_page: 100,
			})
			.pipe(Effect.catchAll(() => Effect.succeed([])));

		const comments = rawComments.map((c) => ({
			githubCommentId: c.id,
			authorUserId: userCollector.collect(c.user),
			body: c.body ?? "",
			createdAt: isoToMs(c.created_at) ?? Date.now(),
			updatedAt: isoToMs(c.updated_at) ?? Date.now(),
		}));

		if (comments.length > 0) {
			yield* ctx.runMutation(internal.rpc.onDemandSync.upsertPrComments, {
				repositoryId,
				prNumber: args.number,
				comments,
			});
		}

		// 5. Upsert users
		const allUsers = userCollector.getUsers();
		if (allUsers.length > 0) {
			yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertUsers, {
				users: allUsers,
			});
		}

		// 6. Update projections
		yield* ctx.runMutation(internal.rpc.onDemandSync.writeAndProject, {
			repositoryId,
		});

		return { synced: true, repositoryId };
	}),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const onDemandSyncModule = makeRpcModule(
	{
		syncPullRequest: syncPullRequestDef,
		syncIssue: syncIssueDef,
		ensureRepo: ensureRepoDef,
		upsertPrComments: upsertPrCommentsDef,
		upsertPrReviews: upsertPrReviewsDef,
		upsertPrReviewComments: upsertPrReviewCommentsDef,
		writeAndProject: writeAndProjectDef,
		checkEntityExists: checkEntityExistsDef,
	},
	{ middlewares: DatabaseRpcModuleMiddlewares },
);

export const {
	syncPullRequest,
	syncIssue,
	ensureRepo,
	upsertPrComments,
	upsertPrReviews,
	upsertPrReviewComments,
	writeAndProject,
	checkEntityExists,
} = onDemandSyncModule.handlers;
export { onDemandSyncModule, EntityNotFound, RepoNotFoundOnGitHub };
export type OnDemandSyncModule = typeof onDemandSyncModule;
