import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { ConfectMutationCtx, confectSchema } from "../confect";
import {
	syncCheckRunInsert,
	syncCheckRunReplace,
	syncCommentInsert,
	syncCommentReplace,
	syncIssueInsert,
	syncIssueReplace,
	syncJobInsert,
	syncJobReplace,
	syncPrInsert,
	syncPrReplace,
	syncReviewInsert,
	syncReviewReplace,
} from "../shared/aggregateSync";
import {
	updateAllProjections,
	updateRepoOverview,
	upsertIssueView,
	upsertPullRequestView,
	upsertWorkflowRunView,
} from "../shared/projections";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

/**
 * Upsert a batch of branches for a repository.
 */
const upsertBranchesDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		branches: Schema.Array(
			Schema.Struct({
				name: Schema.String,
				headSha: Schema.String,
				protected: Schema.Boolean,
			}),
		),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

/**
 * Upsert a batch of pull requests for a repository.
 */
const upsertPullRequestsDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		pullRequests: Schema.Array(
			Schema.Struct({
				githubPrId: Schema.Number,
				number: Schema.Number,
				state: Schema.Literal("open", "closed"),
				draft: Schema.Boolean,
				title: Schema.String,
				body: Schema.NullOr(Schema.String),
				authorUserId: Schema.NullOr(Schema.Number),
				assigneeUserIds: Schema.Array(Schema.Number),
				requestedReviewerUserIds: Schema.Array(Schema.Number),
				baseRefName: Schema.String,
				headRefName: Schema.String,
				headSha: Schema.String,
				mergeableState: Schema.NullOr(Schema.String),
				mergedAt: Schema.NullOr(Schema.Number),
				closedAt: Schema.NullOr(Schema.Number),
				githubUpdatedAt: Schema.Number,
			}),
		),
		/** Skip expensive projection updates during bulk bootstrap writes. */
		skipProjections: Schema.optionalWith(Schema.Boolean, {
			default: () => false,
		}),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

/**
 * Upsert a batch of issues for a repository.
 */
const upsertIssuesDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		issues: Schema.Array(
			Schema.Struct({
				githubIssueId: Schema.Number,
				number: Schema.Number,
				state: Schema.Literal("open", "closed"),
				title: Schema.String,
				body: Schema.NullOr(Schema.String),
				authorUserId: Schema.NullOr(Schema.Number),
				assigneeUserIds: Schema.Array(Schema.Number),
				labelNames: Schema.Array(Schema.String),
				commentCount: Schema.Number,
				isPullRequest: Schema.Boolean,
				closedAt: Schema.NullOr(Schema.Number),
				githubUpdatedAt: Schema.Number,
			}),
		),
		/** Skip expensive projection updates during bulk bootstrap writes. */
		skipProjections: Schema.optionalWith(Schema.Boolean, {
			default: () => false,
		}),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

/**
 * Upsert a GitHub user (extracted from PR/issue author data).
 */
const upsertUsersDef = factory.internalMutation({
	payload: {
		users: Schema.Array(
			Schema.Struct({
				githubUserId: Schema.Number,
				login: Schema.String,
				avatarUrl: Schema.NullOr(Schema.String),
				siteAdmin: Schema.Boolean,
				type: Schema.Literal("User", "Bot", "Organization"),
			}),
		),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

/**
 * Upsert a batch of commits for a repository.
 */
const upsertCommitsDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		commits: Schema.Array(
			Schema.Struct({
				sha: Schema.String,
				authorUserId: Schema.NullOr(Schema.Number),
				committerUserId: Schema.NullOr(Schema.Number),
				messageHeadline: Schema.String,
				authoredAt: Schema.NullOr(Schema.Number),
				committedAt: Schema.NullOr(Schema.Number),
				additions: Schema.NullOr(Schema.Number),
				deletions: Schema.NullOr(Schema.Number),
				changedFiles: Schema.NullOr(Schema.Number),
			}),
		),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

/**
 * Upsert a batch of check runs for a repository.
 */
const upsertCheckRunsDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		checkRuns: Schema.Array(
			Schema.Struct({
				githubCheckRunId: Schema.Number,
				name: Schema.String,
				headSha: Schema.String,
				status: Schema.String,
				conclusion: Schema.NullOr(Schema.String),
				startedAt: Schema.NullOr(Schema.Number),
				completedAt: Schema.NullOr(Schema.Number),
			}),
		),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

/**
 * Upsert a batch of workflow runs for a repository.
 */
const upsertWorkflowRunsDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		workflowRuns: Schema.Array(
			Schema.Struct({
				githubRunId: Schema.Number,
				workflowId: Schema.Number,
				workflowName: Schema.NullOr(Schema.String),
				runNumber: Schema.Number,
				runAttempt: Schema.Number,
				event: Schema.String,
				status: Schema.NullOr(Schema.String),
				conclusion: Schema.NullOr(Schema.String),
				headBranch: Schema.NullOr(Schema.String),
				headSha: Schema.String,
				actorUserId: Schema.NullOr(Schema.Number),
				htmlUrl: Schema.NullOr(Schema.String),
				createdAt: Schema.Number,
				updatedAt: Schema.Number,
			}),
		),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

/**
 * Upsert a batch of workflow jobs for a repository.
 */
const upsertWorkflowJobsDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		workflowJobs: Schema.Array(
			Schema.Struct({
				githubJobId: Schema.Number,
				githubRunId: Schema.Number,
				name: Schema.String,
				status: Schema.String,
				conclusion: Schema.NullOr(Schema.String),
				startedAt: Schema.NullOr(Schema.Number),
				completedAt: Schema.NullOr(Schema.Number),
				runnerName: Schema.NullOr(Schema.String),
				stepsJson: Schema.NullOr(Schema.String),
			}),
		),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

/**
 * Mark a sync job as complete or failed.
 */
const updateSyncJobStateDef = factory.internalMutation({
	payload: {
		lockKey: Schema.String,
		state: Schema.Literal("running", "done", "failed", "retry"),
		lastError: Schema.NullOr(Schema.String),
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
});

upsertBranchesDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		let upserted = 0;

		for (const branch of args.branches) {
			const existing = yield* ctx.db
				.query("github_branches")
				.withIndex("by_repositoryId_and_name", (q) =>
					q.eq("repositoryId", args.repositoryId).eq("name", branch.name),
				)
				.first();

			if (Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, {
					headSha: branch.headSha,
					protected: branch.protected,
					updatedAt: now,
				});
			} else {
				yield* ctx.db.insert("github_branches", {
					repositoryId: args.repositoryId,
					name: branch.name,
					headSha: branch.headSha,
					protected: branch.protected,
					updatedAt: now,
				});
			}
			upserted++;
		}

		return { upserted };
	}),
);

upsertPullRequestsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const rawCtx = ctx.rawCtx;
		const now = Date.now();
		let upserted = 0;

		for (const pr of args.pullRequests) {
			const existing = yield* ctx.db
				.query("github_pull_requests")
				.withIndex("by_repositoryId_and_number", (q) =>
					q.eq("repositoryId", args.repositoryId).eq("number", pr.number),
				)
				.first();

			const data = {
				repositoryId: args.repositoryId,
				githubPrId: pr.githubPrId,
				number: pr.number,
				state: pr.state,
				draft: pr.draft,
				title: pr.title,
				body: pr.body,
				authorUserId: pr.authorUserId,
				assigneeUserIds: [...pr.assigneeUserIds],
				requestedReviewerUserIds: [...pr.requestedReviewerUserIds],
				baseRefName: pr.baseRefName,
				headRefName: pr.headRefName,
				headSha: pr.headSha,
				mergeableState: pr.mergeableState,
				mergedAt: pr.mergedAt,
				closedAt: pr.closedAt,
				githubUpdatedAt: pr.githubUpdatedAt,
				cachedAt: now,
			};

			if (Option.isSome(existing)) {
				// Out-of-order protection: only update if newer
				if (pr.githubUpdatedAt >= existing.value.githubUpdatedAt) {
					yield* ctx.db.patch(existing.value._id, data);
					// Sync aggregate: read back patched doc for new state
					const updated = yield* ctx.db.get(existing.value._id);
					if (Option.isSome(updated)) {
						yield* syncPrReplace(rawCtx, existing.value, updated.value);
					}
				}
			} else {
				const id = yield* ctx.db.insert("github_pull_requests", data);
				const inserted = yield* ctx.db.get(id);
				if (Option.isSome(inserted)) {
					yield* syncPrInsert(rawCtx, inserted.value);
				}
			}
			upserted++;
		}

		// Incrementally update projections so subscriptions push new data to the UI
		// (skipped during bootstrap — projections are rebuilt once at the end)
		if (!args.skipProjections) {
			for (const pr of args.pullRequests) {
				yield* upsertPullRequestView(args.repositoryId, pr).pipe(
					Effect.ignoreLogged,
				);
			}
			yield* updateRepoOverview(args.repositoryId).pipe(Effect.ignoreLogged);
		}

		return { upserted };
	}),
);

upsertIssuesDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const rawCtx = ctx.rawCtx;
		const now = Date.now();
		let upserted = 0;

		for (const issue of args.issues) {
			const existing = yield* ctx.db
				.query("github_issues")
				.withIndex("by_repositoryId_and_number", (q) =>
					q.eq("repositoryId", args.repositoryId).eq("number", issue.number),
				)
				.first();

			const data = {
				repositoryId: args.repositoryId,
				githubIssueId: issue.githubIssueId,
				number: issue.number,
				state: issue.state,
				title: issue.title,
				body: issue.body,
				authorUserId: issue.authorUserId,
				assigneeUserIds: [...issue.assigneeUserIds],
				labelNames: [...issue.labelNames],
				commentCount: issue.commentCount,
				isPullRequest: issue.isPullRequest,
				closedAt: issue.closedAt,
				githubUpdatedAt: issue.githubUpdatedAt,
				cachedAt: now,
			};

			if (Option.isSome(existing)) {
				if (issue.githubUpdatedAt >= existing.value.githubUpdatedAt) {
					yield* ctx.db.patch(existing.value._id, data);
					const updated = yield* ctx.db.get(existing.value._id);
					if (Option.isSome(updated)) {
						yield* syncIssueReplace(rawCtx, existing.value, updated.value);
					}
				}
			} else {
				const id = yield* ctx.db.insert("github_issues", data);
				const inserted = yield* ctx.db.get(id);
				if (Option.isSome(inserted)) {
					yield* syncIssueInsert(rawCtx, inserted.value);
				}
			}
			upserted++;
		}

		// Incrementally update projections so subscriptions push new data to the UI
		// (skipped during bootstrap — projections are rebuilt once at the end)
		if (!args.skipProjections) {
			for (const issue of args.issues) {
				yield* upsertIssueView(args.repositoryId, issue).pipe(
					Effect.ignoreLogged,
				);
			}
			yield* updateRepoOverview(args.repositoryId).pipe(Effect.ignoreLogged);
		}

		return { upserted };
	}),
);

upsertUsersDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		let upserted = 0;

		for (const user of args.users) {
			const existing = yield* ctx.db
				.query("github_users")
				.withIndex("by_githubUserId", (q) =>
					q.eq("githubUserId", user.githubUserId),
				)
				.first();

			if (Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, {
					login: user.login,
					avatarUrl: user.avatarUrl,
					siteAdmin: user.siteAdmin,
					type: user.type,
					updatedAt: now,
				});
			} else {
				yield* ctx.db.insert("github_users", {
					githubUserId: user.githubUserId,
					login: user.login,
					avatarUrl: user.avatarUrl,
					siteAdmin: user.siteAdmin,
					type: user.type,
					updatedAt: now,
				});
			}
			upserted++;
		}

		return { upserted };
	}),
);

upsertCommitsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		let upserted = 0;

		for (const commit of args.commits) {
			const existing = yield* ctx.db
				.query("github_commits")
				.withIndex("by_repositoryId_and_sha", (q) =>
					q.eq("repositoryId", args.repositoryId).eq("sha", commit.sha),
				)
				.first();

			if (Option.isSome(existing)) {
				// Update with richer data if available (e.g. additions/deletions from API)
				yield* ctx.db.patch(existing.value._id, {
					authorUserId: commit.authorUserId ?? existing.value.authorUserId,
					committerUserId:
						commit.committerUserId ?? existing.value.committerUserId,
					messageHeadline: commit.messageHeadline,
					authoredAt: commit.authoredAt ?? existing.value.authoredAt,
					committedAt: commit.committedAt ?? existing.value.committedAt,
					additions: commit.additions ?? existing.value.additions,
					deletions: commit.deletions ?? existing.value.deletions,
					changedFiles: commit.changedFiles ?? existing.value.changedFiles,
					cachedAt: now,
				});
			} else {
				yield* ctx.db.insert("github_commits", {
					repositoryId: args.repositoryId,
					sha: commit.sha,
					authorUserId: commit.authorUserId,
					committerUserId: commit.committerUserId,
					messageHeadline: commit.messageHeadline,
					authoredAt: commit.authoredAt,
					committedAt: commit.committedAt,
					additions: commit.additions,
					deletions: commit.deletions,
					changedFiles: commit.changedFiles,
					cachedAt: now,
				});
			}
			upserted++;
		}

		return { upserted };
	}),
);

upsertCheckRunsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const rawCtx = ctx.rawCtx;
		let upserted = 0;

		for (const cr of args.checkRuns) {
			const existing = yield* ctx.db
				.query("github_check_runs")
				.withIndex("by_repositoryId_and_githubCheckRunId", (q) =>
					q
						.eq("repositoryId", args.repositoryId)
						.eq("githubCheckRunId", cr.githubCheckRunId),
				)
				.first();

			const data = {
				repositoryId: args.repositoryId,
				githubCheckRunId: cr.githubCheckRunId,
				name: cr.name,
				headSha: cr.headSha,
				status: cr.status,
				conclusion: cr.conclusion,
				startedAt: cr.startedAt,
				completedAt: cr.completedAt,
			};

			if (Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, data);
				const updated = yield* ctx.db.get(existing.value._id);
				if (Option.isSome(updated)) {
					yield* syncCheckRunReplace(rawCtx, existing.value, updated.value);
				}
			} else {
				const id = yield* ctx.db.insert("github_check_runs", data);
				const inserted = yield* ctx.db.get(id);
				if (Option.isSome(inserted)) {
					yield* syncCheckRunInsert(rawCtx, inserted.value);
				}
			}
			upserted++;
		}

		// Check runs affect PR list view (lastCheckConclusion) and overview (failingCheckCount).
		// Instead of full rebuild, find the affected PRs by headSha and update just those views.
		const affectedShas = [...new Set(args.checkRuns.map((cr) => cr.headSha))];
		for (const sha of affectedShas) {
			const affectedPr = yield* ctx.db
				.query("github_pull_requests")
				.withIndex("by_repositoryId_and_headSha", (q) =>
					q.eq("repositoryId", args.repositoryId).eq("headSha", sha),
				)
				.first();
			if (Option.isSome(affectedPr)) {
				yield* upsertPullRequestView(args.repositoryId, affectedPr.value).pipe(
					Effect.ignoreLogged,
				);
			}
		}
		yield* updateRepoOverview(args.repositoryId).pipe(Effect.ignoreLogged);

		return { upserted };
	}),
);

upsertWorkflowRunsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		let upserted = 0;

		for (const run of args.workflowRuns) {
			const existing = yield* ctx.db
				.query("github_workflow_runs")
				.withIndex("by_repositoryId_and_githubRunId", (q) =>
					q
						.eq("repositoryId", args.repositoryId)
						.eq("githubRunId", run.githubRunId),
				)
				.first();

			const data = {
				repositoryId: args.repositoryId,
				githubRunId: run.githubRunId,
				workflowId: run.workflowId,
				workflowName: run.workflowName,
				runNumber: run.runNumber,
				runAttempt: run.runAttempt,
				event: run.event,
				status: run.status,
				conclusion: run.conclusion,
				headBranch: run.headBranch,
				headSha: run.headSha,
				actorUserId: run.actorUserId,
				htmlUrl: run.htmlUrl,
				createdAt: run.createdAt,
				updatedAt: run.updatedAt,
			};

			if (Option.isSome(existing)) {
				if (run.updatedAt >= existing.value.updatedAt) {
					yield* ctx.db.patch(existing.value._id, data);
				}
			} else {
				yield* ctx.db.insert("github_workflow_runs", data);
			}
			upserted++;
		}

		// Incrementally update workflow run projection per-entity
		for (const run of args.workflowRuns) {
			yield* upsertWorkflowRunView(args.repositoryId, run).pipe(
				Effect.ignoreLogged,
			);
		}

		return { upserted };
	}),
);

upsertWorkflowJobsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const rawCtx = ctx.rawCtx;
		let upserted = 0;

		for (const job of args.workflowJobs) {
			const existing = yield* ctx.db
				.query("github_workflow_jobs")
				.withIndex("by_repositoryId_and_githubJobId", (q) =>
					q
						.eq("repositoryId", args.repositoryId)
						.eq("githubJobId", job.githubJobId),
				)
				.first();

			const data = {
				repositoryId: args.repositoryId,
				githubJobId: job.githubJobId,
				githubRunId: job.githubRunId,
				name: job.name,
				status: job.status,
				conclusion: job.conclusion,
				startedAt: job.startedAt,
				completedAt: job.completedAt,
				runnerName: job.runnerName,
				stepsJson: job.stepsJson,
			};

			if (Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, data);
				const updated = yield* ctx.db.get(existing.value._id);
				if (Option.isSome(updated)) {
					yield* syncJobReplace(rawCtx, existing.value, updated.value);
				}
			} else {
				const id = yield* ctx.db.insert("github_workflow_jobs", data);
				const inserted = yield* ctx.db.get(id);
				if (Option.isSome(inserted)) {
					yield* syncJobInsert(rawCtx, inserted.value);
				}
			}
			upserted++;
		}

		// Job counts feed into the workflow run list view — update affected runs
		const affectedRunIds = [
			...new Set(args.workflowJobs.map((j) => j.githubRunId)),
		];
		for (const runId of affectedRunIds) {
			const run = yield* ctx.db
				.query("github_workflow_runs")
				.withIndex("by_repositoryId_and_githubRunId", (q) =>
					q.eq("repositoryId", args.repositoryId).eq("githubRunId", runId),
				)
				.first();
			if (Option.isSome(run)) {
				yield* upsertWorkflowRunView(args.repositoryId, run.value).pipe(
					Effect.ignoreLogged,
				);
			}
		}

		return { upserted };
	}),
);

updateSyncJobStateDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();

		const job = yield* ctx.db
			.query("github_sync_jobs")
			.withIndex("by_lockKey", (q) => q.eq("lockKey", args.lockKey))
			.first();

		if (Option.isNone(job)) {
			return { updated: false };
		}

		yield* ctx.db.patch(job.value._id, {
			state: args.state,
			lastError: args.lastError,
			attemptCount: job.value.attemptCount + 1,
			updatedAt: now,
		});

		// When bootstrap completes, update the repo overview counters.
		// The individual view tables (PR list, issue list, workflow runs)
		// are updated incrementally during each batch write, so we only
		// need to refresh the aggregate counts here.
		if (args.state === "done" && job.value.repositoryId !== null) {
			yield* updateRepoOverview(job.value.repositoryId).pipe(
				Effect.ignoreLogged,
			);
		}

		return { updated: true };
	}),
);

/**
 * Internal mutations called by the bootstrap action to write fetched
 * GitHub data into normalized domain tables.
 *
 * All writes are idempotent upserts keyed by GitHub IDs.
 */
const bootstrapWriteModule = makeRpcModule(
	{
		upsertBranches: upsertBranchesDef,
		upsertPullRequests: upsertPullRequestsDef,
		upsertIssues: upsertIssuesDef,
		upsertCommits: upsertCommitsDef,
		upsertCheckRuns: upsertCheckRunsDef,
		upsertWorkflowRuns: upsertWorkflowRunsDef,
		upsertWorkflowJobs: upsertWorkflowJobsDef,
		upsertUsers: upsertUsersDef,
		updateSyncJobState: updateSyncJobStateDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const {
	upsertBranches,
	upsertPullRequests,
	upsertIssues,
	upsertCommits,
	upsertCheckRuns,
	upsertWorkflowRuns,
	upsertWorkflowJobs,
	upsertUsers,
	updateSyncJobState,
} = bootstrapWriteModule.handlers;
export { bootstrapWriteModule };
export type BootstrapWriteModule = typeof bootstrapWriteModule;
