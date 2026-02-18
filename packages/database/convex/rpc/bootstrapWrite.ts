import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { ConfectMutationCtx, confectSchema } from "../confect";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

/**
 * Internal mutations called by the bootstrap action to write fetched
 * GitHub data into normalized domain tables.
 *
 * All writes are idempotent upserts keyed by GitHub IDs.
 */
const bootstrapWriteModule = makeRpcModule(
	{
		/**
		 * Upsert a batch of branches for a repository.
		 */
		upsertBranches: factory.internalMutation(
			{
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
			},
			(args) =>
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
		),

		/**
		 * Upsert a batch of pull requests for a repository.
		 */
		upsertPullRequests: factory.internalMutation(
			{
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
				},
				success: Schema.Struct({ upserted: Schema.Number }),
			},
			(args) =>
				Effect.gen(function* () {
					const ctx = yield* ConfectMutationCtx;
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
							}
						} else {
							yield* ctx.db.insert("github_pull_requests", data);
						}
						upserted++;
					}

					return { upserted };
				}),
		),

		/**
		 * Upsert a batch of issues for a repository.
		 */
		upsertIssues: factory.internalMutation(
			{
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
				},
				success: Schema.Struct({ upserted: Schema.Number }),
			},
			(args) =>
				Effect.gen(function* () {
					const ctx = yield* ConfectMutationCtx;
					const now = Date.now();
					let upserted = 0;

					for (const issue of args.issues) {
						const existing = yield* ctx.db
							.query("github_issues")
							.withIndex("by_repositoryId_and_number", (q) =>
								q
									.eq("repositoryId", args.repositoryId)
									.eq("number", issue.number),
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
							}
						} else {
							yield* ctx.db.insert("github_issues", data);
						}
						upserted++;
					}

					return { upserted };
				}),
		),

		/**
		 * Upsert a GitHub user (extracted from PR/issue author data).
		 */
		upsertUsers: factory.internalMutation(
			{
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
			},
			(args) =>
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
		),

		/**
		 * Mark a sync job as complete or failed.
		 */
		updateSyncJobState: factory.internalMutation(
			{
				payload: {
					lockKey: Schema.String,
					state: Schema.Literal("running", "done", "failed", "retry"),
					lastError: Schema.NullOr(Schema.String),
				},
				success: Schema.Struct({ updated: Schema.Boolean }),
			},
			(args) =>
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

					return { updated: true };
				}),
		),
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const {
	upsertBranches,
	upsertPullRequests,
	upsertIssues,
	upsertUsers,
	updateSyncJobState,
} = bootstrapWriteModule.handlers;
export { bootstrapWriteModule };
export type BootstrapWriteModule = typeof bootstrapWriteModule;
