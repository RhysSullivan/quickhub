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
 *   3. Fetch PR comments, reviews, check runs
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
import { Effect, Option, Schema } from "effect";
import { internal } from "../_generated/api";
import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	confectSchema,
} from "../confect";
import {
	GitHubApiClient,
	GitHubApiError,
	GitHubRateLimitError,
} from "../shared/githubApi";
import { lookupGitHubTokenByUserIdConfect } from "../shared/githubToken";
import { updateAllProjections } from "../shared/projections";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

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
// GitHub response parsing helpers (shared with bootstrap)
// ---------------------------------------------------------------------------

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const bool = (v: unknown): boolean => v === true;

const isoToMs = (v: unknown): number | null => {
	if (typeof v !== "string") return null;
	const ms = new Date(v).getTime();
	return Number.isNaN(ms) ? null : ms;
};

const userType = (v: unknown): "User" | "Bot" | "Organization" =>
	v === "Bot" ? "Bot" : v === "Organization" ? "Organization" : "User";

type UserRecord = {
	githubUserId: number;
	login: string;
	avatarUrl: string | null;
	siteAdmin: boolean;
	type: "User" | "Bot" | "Organization";
};

const createUserCollector = () => {
	const userMap = new Map<number, UserRecord>();

	const collect = (u: unknown): number | null => {
		if (
			u !== null &&
			u !== undefined &&
			typeof u === "object" &&
			"id" in u &&
			"login" in u
		) {
			const id = num(u.id);
			const login = str(u.login);
			if (id !== null && login !== null && !userMap.has(id)) {
				userMap.set(id, {
					githubUserId: id,
					login,
					avatarUrl: "avatar_url" in u ? str(u.avatar_url) : null,
					siteAdmin: "site_admin" in u ? u.site_admin === true : false,
					type: "type" in u ? userType(u.type) : "User",
				});
			}
			return id;
		}
		return null;
	};

	const getUsers = () => [...userMap.values()];

	return { collect, getUsers };
};

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
// Internal mutation: write data + update projections
// ---------------------------------------------------------------------------

const writeAndProjectDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
	},
	success: Schema.Struct({ ok: Schema.Boolean }),
});

writeAndProjectDef.implement((args) =>
	Effect.gen(function* () {
		yield* updateAllProjections(args.repositoryId);
		return { ok: true };
	}),
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

const syncPullRequestDef = factory.action({
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
});

syncPullRequestDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

		// Resolve the signed-in user's GitHub OAuth token
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) {
			return yield* new EntityNotFound({
				ownerLogin: args.ownerLogin,
				name: args.name,
				entityType: "pull_request",
				number: args.number,
			});
		}
		const userId = identity.value.subject;
		const token = yield* lookupGitHubTokenByUserIdConfect(
			ctx.runQuery,
			userId,
		).pipe(
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

		const fullName = `${args.ownerLogin}/${args.name}`;
		const users = createUserCollector();

		// 1. Ensure repo exists — fetch repo metadata if needed
		const repoCheck = yield* ctx.runQuery(
			internal.rpc.onDemandSync.checkEntityExists,
			{
				ownerLogin: args.ownerLogin,
				name: args.name,
				entityType: "pull_request",
				number: args.number,
			},
		);

		// If entity already exists, just return
		if (repoCheck === true) {
			// Still get the repositoryId
			const ensureResult = yield* ctx.runMutation(
				internal.rpc.onDemandSync.ensureRepo,
				{ ownerLogin: args.ownerLogin, name: args.name },
			);
			const EnsureResultSchema = Schema.NullOr(
				Schema.Struct({
					repositoryId: Schema.Number,
					alreadyExists: Schema.Boolean,
				}),
			);
			const decoded =
				Schema.decodeUnknownSync(EnsureResultSchema)(ensureResult);
			if (decoded === null) {
				return yield* new RepoNotFoundOnGitHub({
					ownerLogin: args.ownerLogin,
					name: args.name,
				});
			}
			return { synced: false, repositoryId: decoded.repositoryId };
		}

		// 2. Fetch repo metadata from GitHub to ensure repo record exists
		const repoData = yield* gh
			.use(async (fetch) => {
				const res = await fetch(`/repos/${fullName}`);
				if (res.status === 404) return null;
				if (!res.ok) {
					throw new GitHubApiError({
						status: res.status,
						message: await res.text(),
						url: res.url,
					});
				}
				return (await res.json()) as Record<string, unknown>;
			})
			.pipe(
				Effect.catchTags({
					GitHubApiError: () => Effect.succeed(null),
					GitHubRateLimitError: () => Effect.succeed(null),
				}),
			);

		if (repoData === null) {
			return yield* new RepoNotFoundOnGitHub({
				ownerLogin: args.ownerLogin,
				name: args.name,
			});
		}

		const githubRepoId = num(repoData.id);
		if (githubRepoId === null) {
			return yield* new RepoNotFoundOnGitHub({
				ownerLogin: args.ownerLogin,
				name: args.name,
			});
		}

		const owner = repoData.owner as Record<string, unknown> | null;

		// Ensure repo record exists
		const ensureResult = yield* ctx.runMutation(
			internal.rpc.onDemandSync.ensureRepo,
			{
				ownerLogin: args.ownerLogin,
				name: args.name,
				repoData: {
					githubRepoId,
					ownerId: num(owner?.id) ?? 0,
					defaultBranch: str(repoData.default_branch) ?? "main",
					visibility: bool(repoData.private) ? "private" : "public",
					isPrivate: bool(repoData.private),
					fullName,
				},
			},
		);

		const EnsureResultSchema = Schema.NullOr(
			Schema.Struct({
				repositoryId: Schema.Number,
				alreadyExists: Schema.Boolean,
			}),
		);
		const ensureDecoded =
			Schema.decodeUnknownSync(EnsureResultSchema)(ensureResult);

		if (ensureDecoded === null) {
			return yield* new RepoNotFoundOnGitHub({
				ownerLogin: args.ownerLogin,
				name: args.name,
			});
		}

		const repositoryId = ensureDecoded.repositoryId;

		// 3. Fetch the PR from GitHub
		const prData = yield* gh
			.use(async (fetch) => {
				const res = await fetch(`/repos/${fullName}/pulls/${args.number}`);
				if (res.status === 404) return null;
				if (!res.ok) {
					throw new GitHubApiError({
						status: res.status,
						message: await res.text(),
						url: res.url,
					});
				}
				return (await res.json()) as Record<string, unknown>;
			})
			.pipe(
				Effect.catchTags({
					GitHubApiError: () => Effect.succeed(null),
					GitHubRateLimitError: () => Effect.succeed(null),
				}),
			);

		if (prData === null) {
			return yield* new EntityNotFound({
				ownerLogin: args.ownerLogin,
				name: args.name,
				entityType: "pull_request",
				number: args.number,
			});
		}

		const head =
			typeof prData.head === "object" && prData.head !== null
				? (prData.head as Record<string, unknown>)
				: {};
		const base =
			typeof prData.base === "object" && prData.base !== null
				? (prData.base as Record<string, unknown>)
				: {};

		const authorUserId = users.collect(prData.user);

		const pr = {
			githubPrId: num(prData.id) ?? 0,
			number: num(prData.number) ?? args.number,
			state: (prData.state === "open" ? "open" : "closed") as "open" | "closed",
			draft: prData.draft === true,
			title: str(prData.title) ?? "",
			body: str(prData.body),
			authorUserId,
			assigneeUserIds: [] as Array<number>,
			requestedReviewerUserIds: [] as Array<number>,
			baseRefName: str(base.ref) ?? "",
			headRefName: str(head.ref) ?? "",
			headSha: str(head.sha) ?? "",
			mergeableState: str(prData.mergeable_state),
			mergedAt: isoToMs(prData.merged_at),
			closedAt: isoToMs(prData.closed_at),
			githubUpdatedAt: isoToMs(prData.updated_at) ?? Date.now(),
		};

		// Upsert the PR
		yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertPullRequests, {
			repositoryId,
			pullRequests: [pr],
		});

		// 4. Fetch comments for this PR
		const rawComments = yield* gh
			.use(async (fetch) => {
				const res = await fetch(
					`/repos/${fullName}/issues/${args.number}/comments?per_page=100`,
				);
				if (!res.ok) return [];
				return (await res.json()) as Array<Record<string, unknown>>;
			})
			.pipe(
				Effect.catchAll(() =>
					Effect.succeed([] as Array<Record<string, unknown>>),
				),
			);

		const comments = rawComments.map((c) => ({
			githubCommentId: num(c.id) ?? 0,
			authorUserId: users.collect(c.user),
			body: str(c.body) ?? "",
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

		// 5. Fetch reviews
		const rawReviews = yield* gh
			.use(async (fetch) => {
				const res = await fetch(
					`/repos/${fullName}/pulls/${args.number}/reviews?per_page=100`,
				);
				if (!res.ok) return [];
				return (await res.json()) as Array<Record<string, unknown>>;
			})
			.pipe(
				Effect.catchAll(() =>
					Effect.succeed([] as Array<Record<string, unknown>>),
				),
			);

		const reviews = rawReviews.map((r) => ({
			githubReviewId: num(r.id) ?? 0,
			authorUserId: users.collect(r.user),
			state: str(r.state) ?? "COMMENTED",
			submittedAt: isoToMs(r.submitted_at),
			commitSha: str(r.commit_id),
		}));

		if (reviews.length > 0) {
			yield* ctx.runMutation(internal.rpc.onDemandSync.upsertPrReviews, {
				repositoryId,
				prNumber: args.number,
				reviews,
			});
		}

		// 6. Fetch check runs for the PR's head SHA
		if (pr.headSha !== "") {
			const rawCheckRuns = yield* gh
				.use(async (fetch) => {
					const res = await fetch(
						`/repos/${fullName}/commits/${pr.headSha}/check-runs?per_page=100`,
					);
					if (!res.ok) return [];
					const data = (await res.json()) as Record<string, unknown>;
					return Array.isArray(data.check_runs)
						? (data.check_runs as Array<Record<string, unknown>>)
						: [];
				})
				.pipe(
					Effect.catchAll(() =>
						Effect.succeed([] as Array<Record<string, unknown>>),
					),
				);

			const checkRuns = rawCheckRuns
				.map((cr) => {
					const id = num(cr.id);
					const crName = str(cr.name);
					if (id === null || crName === null) return null;
					return {
						githubCheckRunId: id,
						name: crName,
						headSha: pr.headSha,
						status: str(cr.status) ?? "queued",
						conclusion: str(cr.conclusion),
						startedAt: isoToMs(cr.started_at),
						completedAt: isoToMs(cr.completed_at),
					};
				})
				.filter(
					(
						cr,
					): cr is {
						githubCheckRunId: number;
						name: string;
						headSha: string;
						status: string;
						conclusion: string | null;
						startedAt: number | null;
						completedAt: number | null;
					} => cr !== null,
				);

			if (checkRuns.length > 0) {
				yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertCheckRuns, {
					repositoryId,
					checkRuns,
				});
			}
		}

		// 7. Upsert collected users
		const allUsers = users.getUsers();
		if (allUsers.length > 0) {
			yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertUsers, {
				users: allUsers,
			});
		}

		// 8. Update projections
		yield* ctx.runMutation(internal.rpc.onDemandSync.writeAndProject, {
			repositoryId,
		});

		// 9. Schedule PR file sync for diff data
		if (pr.headSha !== "") {
			yield* Effect.promise(() =>
				ctx.scheduler.runAfter(0, internal.rpc.githubActions.syncPrFiles, {
					ownerLogin: args.ownerLogin,
					name: args.name,
					repositoryId,
					pullRequestNumber: args.number,
					headSha: pr.headSha,
					connectedByUserId: userId,
				}),
			);
		}

		return { synced: true, repositoryId };
	}),
);

// ---------------------------------------------------------------------------
// Public action: syncIssue — fetch and write a single issue
// ---------------------------------------------------------------------------

const syncIssueDef = factory.action({
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
});

syncIssueDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

		// Resolve the signed-in user's GitHub OAuth token
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) {
			return yield* new EntityNotFound({
				ownerLogin: args.ownerLogin,
				name: args.name,
				entityType: "issue",
				number: args.number,
			});
		}
		const token = yield* lookupGitHubTokenByUserIdConfect(
			ctx.runQuery,
			identity.value.subject,
		).pipe(
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

		const fullName = `${args.ownerLogin}/${args.name}`;
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
			const ensureResult = yield* ctx.runMutation(
				internal.rpc.onDemandSync.ensureRepo,
				{ ownerLogin: args.ownerLogin, name: args.name },
			);
			const EnsureResultSchema = Schema.NullOr(
				Schema.Struct({
					repositoryId: Schema.Number,
					alreadyExists: Schema.Boolean,
				}),
			);
			const decoded =
				Schema.decodeUnknownSync(EnsureResultSchema)(ensureResult);
			if (decoded === null) {
				return yield* new RepoNotFoundOnGitHub({
					ownerLogin: args.ownerLogin,
					name: args.name,
				});
			}
			return { synced: false, repositoryId: decoded.repositoryId };
		}

		// 2. Fetch repo metadata
		const repoData = yield* gh
			.use(async (fetch) => {
				const res = await fetch(`/repos/${fullName}`);
				if (res.status === 404) return null;
				if (!res.ok) {
					throw new GitHubApiError({
						status: res.status,
						message: await res.text(),
						url: res.url,
					});
				}
				return (await res.json()) as Record<string, unknown>;
			})
			.pipe(
				Effect.catchTags({
					GitHubApiError: () => Effect.succeed(null),
					GitHubRateLimitError: () => Effect.succeed(null),
				}),
			);

		if (repoData === null) {
			return yield* new RepoNotFoundOnGitHub({
				ownerLogin: args.ownerLogin,
				name: args.name,
			});
		}

		const githubRepoId = num(repoData.id);
		if (githubRepoId === null) {
			return yield* new RepoNotFoundOnGitHub({
				ownerLogin: args.ownerLogin,
				name: args.name,
			});
		}

		const owner = repoData.owner as Record<string, unknown> | null;

		// Ensure repo record
		const ensureResult = yield* ctx.runMutation(
			internal.rpc.onDemandSync.ensureRepo,
			{
				ownerLogin: args.ownerLogin,
				name: args.name,
				repoData: {
					githubRepoId,
					ownerId: num(owner?.id) ?? 0,
					defaultBranch: str(repoData.default_branch) ?? "main",
					visibility: bool(repoData.private) ? "private" : "public",
					isPrivate: bool(repoData.private),
					fullName,
				},
			},
		);

		const EnsureResultSchema = Schema.NullOr(
			Schema.Struct({
				repositoryId: Schema.Number,
				alreadyExists: Schema.Boolean,
			}),
		);
		const ensureDecoded =
			Schema.decodeUnknownSync(EnsureResultSchema)(ensureResult);

		if (ensureDecoded === null) {
			return yield* new RepoNotFoundOnGitHub({
				ownerLogin: args.ownerLogin,
				name: args.name,
			});
		}

		const repositoryId = ensureDecoded.repositoryId;

		// 3. Fetch the issue from GitHub
		const issueData = yield* gh
			.use(async (fetch) => {
				const res = await fetch(`/repos/${fullName}/issues/${args.number}`);
				if (res.status === 404) return null;
				if (!res.ok) {
					throw new GitHubApiError({
						status: res.status,
						message: await res.text(),
						url: res.url,
					});
				}
				return (await res.json()) as Record<string, unknown>;
			})
			.pipe(
				Effect.catchTags({
					GitHubApiError: () => Effect.succeed(null),
					GitHubRateLimitError: () => Effect.succeed(null),
				}),
			);

		if (issueData === null) {
			return yield* new EntityNotFound({
				ownerLogin: args.ownerLogin,
				name: args.name,
				entityType: "issue",
				number: args.number,
			});
		}

		// GitHub's issues API also returns PRs — check if this is actually a PR
		const isPullRequest = "pull_request" in issueData;

		const authorUserId = userCollector.collect(issueData.user);

		const labels = Array.isArray(issueData.labels)
			? issueData.labels
					.map((l: unknown) =>
						typeof l === "object" &&
						l !== null &&
						"name" in l &&
						typeof l.name === "string"
							? l.name
							: null,
					)
					.filter((n: string | null): n is string => n !== null)
			: [];

		const issue = {
			githubIssueId: num(issueData.id) ?? 0,
			number: num(issueData.number) ?? args.number,
			state: (issueData.state === "open" ? "open" : "closed") as
				| "open"
				| "closed",
			title: str(issueData.title) ?? "",
			body: str(issueData.body),
			authorUserId,
			assigneeUserIds: [] as Array<number>,
			labelNames: labels,
			commentCount: num(issueData.comments) ?? 0,
			isPullRequest,
			closedAt: isoToMs(issueData.closed_at),
			githubUpdatedAt: isoToMs(issueData.updated_at) ?? Date.now(),
		};

		// Upsert the issue
		yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertIssues, {
			repositoryId,
			issues: [issue],
		});

		// 4. Fetch comments
		const rawComments = yield* gh
			.use(async (fetch) => {
				const res = await fetch(
					`/repos/${fullName}/issues/${args.number}/comments?per_page=100`,
				);
				if (!res.ok) return [];
				return (await res.json()) as Array<Record<string, unknown>>;
			})
			.pipe(
				Effect.catchAll(() =>
					Effect.succeed([] as Array<Record<string, unknown>>),
				),
			);

		const comments = rawComments.map((c) => ({
			githubCommentId: num(c.id) ?? 0,
			authorUserId: userCollector.collect(c.user),
			body: str(c.body) ?? "",
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
		writeAndProject: writeAndProjectDef,
		checkEntityExists: checkEntityExistsDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const {
	syncPullRequest,
	syncIssue,
	ensureRepo,
	upsertPrComments,
	upsertPrReviews,
	writeAndProject,
	checkEntityExists,
} = onDemandSyncModule.handlers;
export { onDemandSyncModule, EntityNotFound, RepoNotFoundOnGitHub };
export type OnDemandSyncModule = typeof onDemandSyncModule;
