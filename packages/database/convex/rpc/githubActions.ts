import type * as HttpClientError from "@effect/platform/HttpClientError";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Either, Option, Schema } from "effect";
import { components, internal } from "../_generated/api";
import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	confectSchema,
} from "../confect";
import { toStringOrNull as str, toNumberOrNull } from "../shared/coerce";
import {
	fetchArrayLenient,
	GitHubApiClient,
	type GitHubApiError,
} from "../shared/githubApi";
import { getInstallationToken } from "../shared/githubApp";
import { lookupGitHubTokenByUserIdConfect } from "../shared/githubToken";
import { DatabaseRpcModuleMiddlewares } from "./moduleMiddlewares";
import {
	ReadGitHubRepoByNameMiddleware,
	ReadGitHubRepoPermission,
} from "./security";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum patch size to store per file (100 KB).
 * GitHub itself truncates patches larger than ~1 MB, but storing
 * very large patches degrades Convex document performance.
 * Files exceeding this are stored with patch=null.
 */
const MAX_PATCH_BYTES = 100_000;

/**
 * Maximum number of files to fetch per PR.
 * GitHub caps at 3000 files. We stop at 300 to stay within
 * Convex mutation size limits.
 */
const MAX_FILES_PER_PR = 300;

/**
 * Maximum number of log characters returned to the client.
 * We return the tail so users see the latest failure details first.
 */
const MAX_JOB_LOG_CHARS = 200_000;

/** Max pages fetched when listing GitHub assignees (100/page). */
const MAX_ASSIGNEE_FETCH_PAGES = 10;

/** Sync users whose permissions are older than 6 hours. */
const PERMISSION_STALE_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Max users processed per cron invocation. */
const DEFAULT_PERMISSION_SYNC_BATCH = 10;

const RepoPermissionItemSchema = Schema.Struct({
	repositoryId: Schema.Number,
	pull: Schema.Boolean,
	triage: Schema.Boolean,
	push: Schema.Boolean,
	maintain: Schema.Boolean,
	admin: Schema.Boolean,
	roleName: Schema.NullOr(Schema.String),
});

const GitHubOwnerUserSchema = Schema.Struct({
	githubUserId: Schema.Number,
	login: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	siteAdmin: Schema.Boolean,
	type: Schema.Literal("User", "Bot", "Organization"),
});

const SyncPermissionsResultSchema = Schema.Struct({
	userId: Schema.String,
	syncedRepoCount: Schema.Number,
	upsertedRepoCount: Schema.Number,
	deletedRepoCount: Schema.Number,
	skipped: Schema.Boolean,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PR_FILE_STATUS = [
	"added",
	"removed",
	"modified",
	"renamed",
	"copied",
	"changed",
	"unchanged",
] as const;
type PrFileStatus = (typeof PR_FILE_STATUS)[number];

const isPrFileStatus = (value: string): value is PrFileStatus =>
	PR_FILE_STATUS.some((status) => status === value);

const toPrFileStatus = (v: unknown): PrFileStatus => {
	const s = typeof v === "string" ? v : "";
	if (isPrFileStatus(s)) return s;
	return "changed";
};

const PullRequestFileForSyncSchema = Schema.Struct({
	filename: Schema.String,
	status: Schema.String,
	additions: Schema.Number,
	deletions: Schema.Number,
	changes: Schema.Number,
	patch: Schema.optional(Schema.NullOr(Schema.String)),
	previous_filename: Schema.optional(Schema.NullOr(Schema.String)),
});

const num = (v: unknown): number => toNumberOrNull(v) ?? 0;

const GitHubAccountSchema = Schema.Struct({
	accountId: Schema.String,
	accessToken: Schema.optional(Schema.NullOr(Schema.String)),
});

const GitHubRepoPermissionSchema = Schema.Struct({
	id: Schema.Number,
	permissions: Schema.Struct({
		pull: Schema.Boolean,
		triage: Schema.Boolean,
		push: Schema.Boolean,
		maintain: Schema.Boolean,
		admin: Schema.Boolean,
	}),
	role_name: Schema.optional(Schema.NullOr(Schema.String)),
});

const decodeGitHubAccount = Schema.decodeUnknownEither(GitHubAccountSchema);
const decodeGitHubRepoPermission = Schema.decodeUnknownEither(
	GitHubRepoPermissionSchema,
);

const toRepoPermissionItem = (value: unknown) => {
	const decoded = decodeGitHubRepoPermission(value);
	if (Either.isLeft(decoded)) return null;
	return {
		repositoryId: decoded.right.id,
		pull: decoded.right.permissions.pull,
		triage: decoded.right.permissions.triage,
		push: decoded.right.permissions.push,
		maintain: decoded.right.permissions.maintain,
		admin: decoded.right.permissions.admin,
		roleName: decoded.right.role_name ?? null,
	};
};

const toGitHubUserType = (value: string): "User" | "Bot" | "Organization" =>
	value === "Bot" ? "Bot" : value === "Organization" ? "Organization" : "User";

// ---------------------------------------------------------------------------
// Endpoint definitions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class NotAuthenticated extends Schema.TaggedError<NotAuthenticated>()(
	"NotAuthenticated",
	{ reason: Schema.String },
) {}

class ActionsControlError extends Schema.TaggedError<ActionsControlError>()(
	"ActionsControlError",
	{ status: Schema.Number, message: Schema.String },
) {}

// ---------------------------------------------------------------------------
// Actions control endpoint definitions
// ---------------------------------------------------------------------------

/**
 * Re-run an entire workflow run.
 * POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun
 */
const rerunWorkflowRunDef = factory.action({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		githubRunId: Schema.Number,
	},
	success: Schema.Struct({ accepted: Schema.Boolean }),
	error: Schema.Union(NotAuthenticated, ActionsControlError),
});

/**
 * Re-run only failed jobs in a workflow run.
 * POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs
 */
const rerunFailedJobsDef = factory.action({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		githubRunId: Schema.Number,
	},
	success: Schema.Struct({ accepted: Schema.Boolean }),
	error: Schema.Union(NotAuthenticated, ActionsControlError),
});

/**
 * Cancel a workflow run.
 * POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel
 */
const cancelWorkflowRunDef = factory.action({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		githubRunId: Schema.Number,
	},
	success: Schema.Struct({ accepted: Schema.Boolean }),
	error: Schema.Union(NotAuthenticated, ActionsControlError),
});

/**
 * Trigger a workflow via workflow_dispatch.
 * POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
 */
const dispatchWorkflowDef = factory.action({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		workflowId: Schema.Number,
		ref: Schema.String,
	},
	success: Schema.Struct({ accepted: Schema.Boolean }),
	error: Schema.Union(NotAuthenticated, ActionsControlError),
});

const PullRequestCommentSideSchema = Schema.Literal("LEFT", "RIGHT");

const createPrReviewCommentDef = factory.action({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		prNumber: Schema.Number,
		commitSha: Schema.optional(Schema.String),
		body: Schema.String,
		path: Schema.String,
		line: Schema.Number,
		side: PullRequestCommentSideSchema,
		startLine: Schema.optional(Schema.Number),
		startSide: Schema.optional(PullRequestCommentSideSchema),
	},
	success: Schema.Struct({
		accepted: Schema.Boolean,
		githubReviewCommentId: Schema.Number,
	}),
	error: Schema.Union(NotAuthenticated, ActionsControlError),
});

const createPrReviewCommentReplyDef = factory.action({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		prNumber: Schema.Number,
		inReplyToGithubReviewCommentId: Schema.Number,
		body: Schema.String,
	},
	success: Schema.Struct({
		accepted: Schema.Boolean,
		githubReviewCommentId: Schema.Number,
	}),
	error: Schema.Union(NotAuthenticated, ActionsControlError),
});

/**
 * Fetch the unified diff for a pull request from the GitHub API.
 * Returns raw unified diff text (or null on 404/error).
 */
const fetchPrDiffDef = factory
	.action({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			number: Schema.Number,
		},
		success: Schema.NullOr(Schema.String),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Fetch workflow job logs on demand from GitHub.
 *
 * Uses the signed-in user's OAuth token and returns log text directly.
 * Returns null when logs are unavailable or the user cannot access them.
 */
const fetchWorkflowJobLogsDef = factory
	.action({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			jobId: Schema.Number,
		},
		success: Schema.NullOr(
			Schema.Struct({
				log: Schema.String,
				truncated: Schema.Boolean,
			}),
		),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

const RepoAssigneeSchema = Schema.Struct({
	login: Schema.String,
	avatarUrl: Schema.String,
});

const RepoAssigneeListItemSchema = Schema.Struct({
	login: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
});

const GraphQlErrorSchema = Schema.Struct({
	message: Schema.String,
});

const AssignableUsersConnectionSchema = Schema.Struct({
	nodes: Schema.Array(RepoAssigneeSchema),
	pageInfo: Schema.Struct({
		hasNextPage: Schema.Boolean,
		endCursor: Schema.NullOr(Schema.String),
	}),
});

const RepoAssignableUsersRepositorySchema = Schema.Struct({
	assignableUsers: AssignableUsersConnectionSchema,
});

const ListRepoAssigneesGraphQlResponseSchema = Schema.Struct({
	data: Schema.optional(
		Schema.Struct({
			repository: Schema.NullOr(RepoAssignableUsersRepositorySchema),
		}),
	),
	errors: Schema.optional(Schema.Array(GraphQlErrorSchema)),
});

const LIST_REPO_ASSIGNEES_QUERY = `
query ListRepoAssignees($owner: String!, $name: String!, $query: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    assignableUsers(first: 100, query: $query, after: $after) {
      nodes {
        login
        avatarUrl
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`;

/**
 * Fetch assignable users for a repository directly from GitHub.
 *
 * Uses the signed-in user's OAuth token and paginates through
 * GraphQL `repository.assignableUsers(query:, first:, after:)` to support
 * repositories where assignees are not yet represented in local projections.
 */
const listRepoAssigneesDef = factory
	.action({
		payload: {
			ownerLogin: Schema.String,
			name: Schema.String,
			query: Schema.optional(Schema.String),
		},
		success: Schema.Array(RepoAssigneeListItemSchema),
	})
	.middleware(ReadGitHubRepoByNameMiddleware);

/**
 * Fetch PR file list from GitHub and persist to Convex.
 * This is the main entry-point for the diff sync pipeline.
 *
 * Flow:
 * 1. Fetches file list from GET /repos/{owner}/{repo}/pulls/{number}/files (paginated)
 * 2. Truncates patches that exceed MAX_PATCH_BYTES
 * 3. Upserts files into github_pull_request_files table
 *
 * Returns the count of files synced (0 on error/404).
 */
const syncPrFilesDef = factory.internalAction({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		repositoryId: Schema.Number,
		pullRequestNumber: Schema.Number,
		headSha: Schema.String,
		/** GitHub App installation ID for token resolution. */
		installationId: Schema.Number,
	},
	success: Schema.Struct({
		fileCount: Schema.Number,
		truncatedPatches: Schema.Number,
	}),
});

/**
 * Internal mutation: upsert a batch of PR files.
 * Called by the syncPrFiles action after fetching from GitHub.
 * Idempotent: existing files for the same repo/PR/filename are replaced.
 */
const upsertPrFilesDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		pullRequestNumber: Schema.Number,
		headSha: Schema.String,
		files: Schema.Array(
			Schema.Struct({
				filename: Schema.String,
				status: Schema.Literal(
					"added",
					"removed",
					"modified",
					"renamed",
					"copied",
					"changed",
					"unchanged",
				),
				additions: Schema.Number,
				deletions: Schema.Number,
				changes: Schema.Number,
				patch: Schema.NullOr(Schema.String),
				previousFilename: Schema.NullOr(Schema.String),
			}),
		),
	},
	success: Schema.Struct({ upserted: Schema.Number }),
});

/**
 * Public action: sync the signed-in viewer's repository permissions.
 * Intended to run after login/session refresh from the client.
 */
const syncViewerPermissionsDef = factory.action({
	success: SyncPermissionsResultSchema,
});

/**
 * Internal action: sync permissions for one Better Auth user ID.
 * Used by cron, webhooks, and other backend flows.
 */
const syncUserPermissionsDef = factory.internalAction({
	payload: {
		userId: Schema.String,
	},
	success: SyncPermissionsResultSchema,
});

/**
 * Internal action: refresh permissions for users with stale sync timestamps.
 */
const syncStalePermissionsDef = factory.internalAction({
	payload: {
		maxUsers: Schema.optional(Schema.Number),
		staleBefore: Schema.optional(Schema.Number),
	},
	success: Schema.Struct({
		attemptedUsers: Schema.Number,
		syncedUsers: Schema.Number,
	}),
});

/**
 * Internal query: list connected repository IDs (GitHub repo IDs).
 */
const listConnectedRepoIdsDef = factory.internalQuery({
	success: Schema.Array(Schema.Number),
});

/**
 * Internal query: list user IDs whose permissions are stale.
 */
const listStalePermissionUserIdsDef = factory.internalQuery({
	payload: {
		staleBefore: Schema.Number,
		limit: Schema.Number,
	},
	success: Schema.Array(Schema.String),
});

/**
 * Internal mutation: upsert repo permissions for one user and remove stale rows.
 */
const upsertUserRepoPermissionsDef = factory.internalMutation({
	payload: {
		userId: Schema.String,
		githubUserId: Schema.Number,
		syncedAt: Schema.Number,
		connectedRepoIds: Schema.Array(Schema.Number),
		repoPermissions: Schema.Array(RepoPermissionItemSchema),
		ownerUsers: Schema.Array(GitHubOwnerUserSchema),
	},
	success: Schema.Struct({
		upsertedRepoCount: Schema.Number,
		deletedRepoCount: Schema.Number,
	}),
});

const resolveRepositoryIdByNameDef = factory.internalQuery({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
	},
	success: Schema.NullOr(Schema.Number),
});

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

const syncPermissionsForUser = (userId: string) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

		const account = yield* ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: "account",
			where: [
				{ field: "providerId", value: "github" },
				{ field: "userId", value: userId },
			],
		});

		if (account === null) {
			return {
				userId,
				syncedRepoCount: 0,
				upsertedRepoCount: 0,
				deletedRepoCount: 0,
				skipped: true,
			};
		}

		const decodedAccount = decodeGitHubAccount(account);
		if (Either.isLeft(decodedAccount)) {
			return {
				userId,
				syncedRepoCount: 0,
				upsertedRepoCount: 0,
				deletedRepoCount: 0,
				skipped: true,
			};
		}

		const accessToken = decodedAccount.right.accessToken;
		if (accessToken === null || accessToken === undefined) {
			return {
				userId,
				syncedRepoCount: 0,
				upsertedRepoCount: 0,
				deletedRepoCount: 0,
				skipped: true,
			};
		}

		const githubUserId = Number(decodedAccount.right.accountId);
		if (Number.isNaN(githubUserId)) {
			return {
				userId,
				syncedRepoCount: 0,
				upsertedRepoCount: 0,
				deletedRepoCount: 0,
				skipped: true,
			};
		}

		const connectedRepoIdsRaw = yield* ctx.runQuery(
			internal.rpc.githubActions.listConnectedRepoIds,
			{},
		);
		const connectedRepoIds = Schema.decodeUnknownSync(
			Schema.Array(Schema.Number),
		)(connectedRepoIdsRaw);
		const connectedRepoIdSet = new Set(connectedRepoIds);

		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(accessToken),
		);

		const repoPermissions: Array<
			Schema.Schema.Type<typeof RepoPermissionItemSchema>
		> = [];
		const ownerUsersById = new Map<
			number,
			Schema.Schema.Type<typeof GitHubOwnerUserSchema>
		>();

		let page = 1;
		let hasMore = true;
		while (hasMore) {
			const repos = yield* gh.client.reposListForAuthenticatedUser({
				per_page: 100,
				page,
				affiliation: "owner,collaborator,organization_member",
			});

			for (const rawRepo of repos) {
				const permission = toRepoPermissionItem(rawRepo);
				if (
					permission !== null &&
					connectedRepoIdSet.has(permission.repositoryId)
				) {
					repoPermissions.push(permission);
					ownerUsersById.set(rawRepo.owner.id, {
						githubUserId: rawRepo.owner.id,
						login: rawRepo.owner.login,
						avatarUrl: rawRepo.owner.avatar_url,
						siteAdmin: rawRepo.owner.site_admin,
						type: toGitHubUserType(rawRepo.owner.type),
					});
				}
			}

			hasMore = repos.length === 100;
			page += 1;
		}

		const persist = yield* ctx.runMutation(
			internal.rpc.githubActions.upsertUserRepoPermissions,
			{
				userId,
				githubUserId,
				syncedAt: Date.now(),
				connectedRepoIds,
				repoPermissions,
				ownerUsers: [...ownerUsersById.values()],
			},
		);

		const PersistResultSchema = Schema.Struct({
			upsertedRepoCount: Schema.Number,
			deletedRepoCount: Schema.Number,
		});
		const persistResult =
			Schema.decodeUnknownSync(PersistResultSchema)(persist);

		return {
			userId,
			syncedRepoCount: repoPermissions.length,
			upsertedRepoCount: persistResult.upsertedRepoCount,
			deletedRepoCount: persistResult.deletedRepoCount,
			skipped: false,
		};
	});

listConnectedRepoIdsDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const repos = yield* ctx.db.query("github_repositories").take(2000);
		return repos.map((repo) => repo.githubRepoId);
	}),
);

resolveRepositoryIdByNameDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isNone(repo)) {
			return null;
		}

		return repo.value.githubRepoId;
	}),
);

listStalePermissionUserIdsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const candidates = yield* ctx.db
			.query("github_user_repo_permissions")
			.withIndex("by_syncedAt", (q) => q.lt("syncedAt", args.staleBefore))
			.take(args.limit * 10);

		const userIds: Array<string> = [];
		const seen = new Set<string>();
		for (const candidate of candidates) {
			if (seen.has(candidate.userId)) continue;
			seen.add(candidate.userId);
			userIds.push(candidate.userId);
			if (userIds.length >= args.limit) break;
		}

		return userIds;
	}),
);

upsertUserRepoPermissionsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		for (const ownerUser of args.ownerUsers) {
			const existingOwner = yield* ctx.db
				.query("github_users")
				.withIndex("by_githubUserId", (q) =>
					q.eq("githubUserId", ownerUser.githubUserId),
				)
				.first();

			if (Option.isSome(existingOwner)) {
				yield* ctx.db.patch(existingOwner.value._id, {
					login: ownerUser.login,
					avatarUrl: ownerUser.avatarUrl,
					siteAdmin: ownerUser.siteAdmin,
					type: ownerUser.type,
					updatedAt: args.syncedAt,
				});
			} else {
				yield* ctx.db.insert("github_users", {
					githubUserId: ownerUser.githubUserId,
					login: ownerUser.login,
					avatarUrl: ownerUser.avatarUrl,
					siteAdmin: ownerUser.siteAdmin,
					type: ownerUser.type,
					updatedAt: args.syncedAt,
				});
			}
		}

		const existingRows = yield* ctx.db
			.query("github_user_repo_permissions")
			.withIndex("by_userId", (q) => q.eq("userId", args.userId))
			.collect();

		const existingByRepository = new Map(
			existingRows.map((row) => [row.repositoryId, row]),
		);

		let upsertedRepoCount = 0;
		for (const permission of args.repoPermissions) {
			const data = {
				userId: args.userId,
				repositoryId: permission.repositoryId,
				githubUserId: args.githubUserId,
				pull: permission.pull,
				triage: permission.triage,
				push: permission.push,
				maintain: permission.maintain,
				admin: permission.admin,
				roleName: permission.roleName,
				syncedAt: args.syncedAt,
			};

			const existing = existingByRepository.get(permission.repositoryId);
			if (existing !== undefined) {
				yield* ctx.db.patch(existing._id, data);
			} else {
				yield* ctx.db.insert("github_user_repo_permissions", data);
			}
			upsertedRepoCount++;
		}

		const connectedRepoSet = new Set(args.connectedRepoIds);
		const incomingRepoSet = new Set(
			args.repoPermissions.map((permission) => permission.repositoryId),
		);

		let deletedRepoCount = 0;
		for (const existing of existingRows) {
			if (
				connectedRepoSet.has(existing.repositoryId) &&
				!incomingRepoSet.has(existing.repositoryId)
			) {
				yield* ctx.db.delete(existing._id);
				deletedRepoCount++;
			}
		}

		return { upsertedRepoCount, deletedRepoCount };
	}),
);

syncViewerPermissionsDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) {
			return {
				userId: "",
				syncedRepoCount: 0,
				upsertedRepoCount: 0,
				deletedRepoCount: 0,
				skipped: true,
			};
		}

		return yield* syncPermissionsForUser(identity.value.subject).pipe(
			Effect.catchAll(() =>
				Effect.succeed({
					userId: identity.value.subject,
					syncedRepoCount: 0,
					upsertedRepoCount: 0,
					deletedRepoCount: 0,
					skipped: true,
				}),
			),
		);
	}),
);

syncUserPermissionsDef.implement((args) =>
	syncPermissionsForUser(args.userId).pipe(
		Effect.catchAll(() =>
			Effect.succeed({
				userId: args.userId,
				syncedRepoCount: 0,
				upsertedRepoCount: 0,
				deletedRepoCount: 0,
				skipped: true,
			}),
		),
	),
);

syncStalePermissionsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const staleBefore =
			args.staleBefore ?? Date.now() - PERMISSION_STALE_WINDOW_MS;
		const maxUsers = args.maxUsers ?? DEFAULT_PERMISSION_SYNC_BATCH;

		const userIdsRaw = yield* ctx.runQuery(
			internal.rpc.githubActions.listStalePermissionUserIds,
			{
				staleBefore,
				limit: maxUsers,
			},
		);
		const userIds = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
			userIdsRaw,
		);

		let syncedUsers = 0;
		for (const userId of userIds) {
			const result = yield* syncPermissionsForUser(userId).pipe(
				Effect.catchAll(() =>
					Effect.succeed({
						userId,
						syncedRepoCount: 0,
						upsertedRepoCount: 0,
						deletedRepoCount: 0,
						skipped: true,
					}),
				),
			);
			if (!result.skipped) {
				syncedUsers++;
			}
		}

		return {
			attemptedUsers: userIds.length,
			syncedUsers,
		};
	}),
);

fetchPrDiffDef.implement((args) =>
	Effect.gen(function* () {
		const permission = yield* ReadGitHubRepoPermission;
		if (!permission.isAllowed) return null;

		const ctx = yield* ConfectActionCtx;
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) return null;

		const token = yield* lookupGitHubTokenByUserIdConfect(
			(query, params) => ctx.runQuery(query, params),
			(mutation, params) => ctx.runMutation(mutation, params),
			identity.value.subject,
		);
		const github = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		const diff = yield* github.pullsGetDiff(
			args.ownerLogin,
			args.name,
			String(args.number),
		);
		return diff;
	}).pipe(Effect.catchAll(() => Effect.succeed(null))),
);

fetchWorkflowJobLogsDef.implement((args) =>
	Effect.gen(function* () {
		const permission = yield* ReadGitHubRepoPermission;
		if (!permission.isAllowed) return null;

		const ctx = yield* ConfectActionCtx;
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) return null;

		const token = yield* lookupGitHubTokenByUserIdConfect(
			(query, params) => ctx.runQuery(query, params),
			(mutation, params) => ctx.runMutation(mutation, params),
			identity.value.subject,
		);
		const github = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		const text = yield* github.actionsDownloadJobLogs(
			args.ownerLogin,
			args.name,
			String(args.jobId),
		);

		if (text === null || text.trim() === "") return null;

		if (text.length <= MAX_JOB_LOG_CHARS) {
			return {
				log: text,
				truncated: false,
			};
		}

		return {
			log: text.slice(-MAX_JOB_LOG_CHARS),
			truncated: true,
		};
	}).pipe(Effect.catchAll(() => Effect.succeed(null))),
);

// ---------------------------------------------------------------------------
// Actions control implementations — uses GitHubApiClient helper methods
// ---------------------------------------------------------------------------

/**
 * Map errors from the GitHubApiClient helper methods into ActionsControlError.
 * The error channel is `GitHubApiError | HttpClientError | NotAuthenticated`, where
 * GitHubApiError has `status`/`message` and HttpClientError has `description`.
 */
const toActionsControlError = (
	e: GitHubApiError | HttpClientError.HttpClientError | NotAuthenticated,
): Effect.Effect<never, ActionsControlError> => {
	if (e._tag === "GitHubApiError") {
		return new ActionsControlError({
			status: e.status,
			message: e.message,
		});
	}
	if (e._tag === "NotAuthenticated") {
		return new ActionsControlError({
			status: 401,
			message: e.reason,
		});
	}
	// HttpClientError (RequestError | ResponseError)
	const status = e._tag === "ResponseError" ? e.response.status : 0;
	return new ActionsControlError({
		status,
		message: e.message,
	});
};

const isoTimestampToMs = (value: string): number => {
	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) return Date.now();
	return parsed;
};

const isoTimestampToMsOrNow = (value: string | undefined): number => {
	if (value === undefined) return Date.now();
	return isoTimestampToMs(value);
};

/**
 * Helper: resolve the signed-in user's GitHub API client for action calls.
 */
const resolveActionsGitHubClient = () =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) {
			return yield* new NotAuthenticated({
				reason: "User is not signed in",
			});
		}
		const token = yield* lookupGitHubTokenByUserIdConfect(
			(query, params) => ctx.runQuery(query, params),
			(mutation, params) => ctx.runMutation(mutation, params),
			identity.value.subject,
		).pipe(Effect.catchAll((e) => new NotAuthenticated({ reason: e.reason })));
		return yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);
	});

const resolveRepositoryIdForWrite = (
	ctx: { runQuery: ConfectActionCtx["runQuery"] },
	ownerLogin: string,
	name: string,
) =>
	Effect.gen(function* () {
		const repositoryIdResult = yield* ctx.runQuery(
			internal.rpc.githubActions.resolveRepositoryIdByName,
			{
				ownerLogin,
				name,
			},
		);

		const repositoryId = Schema.decodeUnknownSync(Schema.NullOr(Schema.Number))(
			repositoryIdResult,
		);

		if (repositoryId === null) {
			return yield* new ActionsControlError({
				status: 404,
				message: `Repository ${ownerLogin}/${name} is not connected`,
			});
		}

		return repositoryId;
	});

listRepoAssigneesDef.implement((args) =>
	Effect.gen(function* () {
		const permission = yield* ReadGitHubRepoPermission;
		if (!permission.isAllowed) return [];

		const github = yield* resolveActionsGitHubClient();
		const normalizedQuery = (args.query ?? "").trim();

		const assigneesByLogin = new Map<
			string,
			Schema.Schema.Type<typeof RepoAssigneeListItemSchema>
		>();

		let page = 1;
		let hasMore = true;
		let cursor: string | null = null;

		while (hasMore && page <= MAX_ASSIGNEE_FETCH_PAGES) {
			const request: HttpClientRequest.HttpClientRequest =
				HttpClientRequest.post("/graphql").pipe(
					HttpClientRequest.bodyUnsafeJson({
						query: LIST_REPO_ASSIGNEES_QUERY,
						variables: {
							owner: args.ownerLogin,
							name: args.name,
							query: normalizedQuery,
							after: cursor,
						},
					}),
				);

			const response: HttpClientResponse.HttpClientResponse =
				yield* github.httpClient.execute(request);

			if (response.status === 404) {
				return [];
			}

			if (response.status < 200 || response.status >= 300) {
				const errorBody = yield* Effect.orElseSucceed(response.text, () => "");
				return yield* Effect.fail(
					new Error(`GitHub API returned ${response.status}: ${errorBody}`),
				);
			}

			const graphQlResponse: Schema.Schema.Type<
				typeof ListRepoAssigneesGraphQlResponseSchema
			> = yield* HttpClientResponse.schemaBodyJson(
				ListRepoAssigneesGraphQlResponseSchema,
			)(response);

			if (
				graphQlResponse.errors !== undefined &&
				graphQlResponse.errors.length > 0
			) {
				const firstError = graphQlResponse.errors[0];
				if (firstError !== undefined) {
					return yield* Effect.fail(new Error(firstError.message));
				}
				return [];
			}

			const repository: Schema.Schema.Type<
				typeof RepoAssignableUsersRepositorySchema
			> | null = graphQlResponse.data?.repository ?? null;
			if (repository === null) {
				return [];
			}

			const pageAssignees = repository.assignableUsers.nodes;

			for (const assignee of pageAssignees) {
				assigneesByLogin.set(assignee.login, {
					login: assignee.login,
					avatarUrl: assignee.avatarUrl,
				});
			}

			hasMore = repository.assignableUsers.pageInfo.hasNextPage;
			cursor = repository.assignableUsers.pageInfo.endCursor;
			page += 1;
		}

		return [...assigneesByLogin.values()].sort((a, b) =>
			a.login.localeCompare(b.login),
		);
	}).pipe(Effect.catchAll(() => Effect.succeed([]))),
);

rerunWorkflowRunDef.implement((args) =>
	Effect.gen(function* () {
		const github = yield* resolveActionsGitHubClient();
		return yield* github.actionsRerunWorkflow(
			encodeURIComponent(args.ownerLogin),
			encodeURIComponent(args.name),
			String(args.githubRunId),
		);
	}).pipe(Effect.catchAll(toActionsControlError)),
);

rerunFailedJobsDef.implement((args) =>
	Effect.gen(function* () {
		const github = yield* resolveActionsGitHubClient();
		return yield* github.actionsRerunFailedJobs(
			encodeURIComponent(args.ownerLogin),
			encodeURIComponent(args.name),
			String(args.githubRunId),
		);
	}).pipe(Effect.catchAll(toActionsControlError)),
);

cancelWorkflowRunDef.implement((args) =>
	Effect.gen(function* () {
		const github = yield* resolveActionsGitHubClient();
		return yield* github.actionsCancelWorkflowRun(
			encodeURIComponent(args.ownerLogin),
			encodeURIComponent(args.name),
			String(args.githubRunId),
		);
	}).pipe(Effect.catchAll(toActionsControlError)),
);

dispatchWorkflowDef.implement((args) =>
	Effect.gen(function* () {
		const github = yield* resolveActionsGitHubClient();
		return yield* github.actionsDispatchWorkflow(
			encodeURIComponent(args.ownerLogin),
			encodeURIComponent(args.name),
			String(args.workflowId),
			args.ref,
		);
	}).pipe(Effect.catchAll(toActionsControlError)),
);

createPrReviewCommentDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const github = yield* resolveActionsGitHubClient();
		const repositoryId = yield* resolveRepositoryIdForWrite(
			ctx,
			args.ownerLogin,
			args.name,
		);

		const commitSha = args.commitSha;
		if (commitSha === undefined) {
			return yield* new ActionsControlError({
				status: 400,
				message: "commitSha is required",
			});
		}

		const comment = yield* github.client
			.pullsCreateReviewComment(
				encodeURIComponent(args.ownerLogin),
				encodeURIComponent(args.name),
				String(args.prNumber),
				{
					payload: {
						body: args.body,
						path: args.path,
						line: args.line,
						side: args.side === "LEFT" ? "LEFT" : "RIGHT",
						commit_id: commitSha,
						start_line: args.startLine,
						start_side:
							args.startSide === "LEFT"
								? "LEFT"
								: args.startSide === "RIGHT"
									? "RIGHT"
									: undefined,
					},
				},
			)
			.pipe(
				Effect.catchAll(
					() =>
						new ActionsControlError({
							status: 0,
							message: "Request failed",
						}),
				),
			);

		yield* ctx.runMutation(internal.rpc.onDemandSync.upsertPrReviewComments, {
			repositoryId,
			prNumber: args.prNumber,
			reviewComments: [
				{
					githubReviewCommentId: comment.id,
					githubReviewId: comment.pull_request_review_id ?? null,
					inReplyToGithubReviewCommentId: comment.in_reply_to_id ?? null,
					authorUserId: comment.user?.id ?? null,
					body: comment.body,
					path: comment.path ?? null,
					line: comment.line ?? null,
					originalLine: comment.original_line ?? null,
					startLine: comment.start_line ?? null,
					side: comment.side ?? null,
					startSide: comment.start_side ?? null,
					commitSha: comment.commit_id ?? null,
					originalCommitSha: comment.original_commit_id ?? null,
					htmlUrl: comment.html_url ?? null,
					createdAt: isoTimestampToMsOrNow(comment.created_at),
					updatedAt: isoTimestampToMsOrNow(comment.updated_at),
				},
			],
		});

		return { accepted: true, githubReviewCommentId: comment.id };
	}),
);

createPrReviewCommentReplyDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const github = yield* resolveActionsGitHubClient();
		const repositoryId = yield* resolveRepositoryIdForWrite(
			ctx,
			args.ownerLogin,
			args.name,
		);

		const comment = yield* github.client
			.pullsCreateReplyForReviewComment(
				encodeURIComponent(args.ownerLogin),
				encodeURIComponent(args.name),
				String(args.prNumber),
				String(args.inReplyToGithubReviewCommentId),
				{
					payload: { body: args.body },
				},
			)
			.pipe(
				Effect.catchAll(
					() =>
						new ActionsControlError({
							status: 0,
							message: "Request failed",
						}),
				),
			);

		yield* ctx.runMutation(internal.rpc.onDemandSync.upsertPrReviewComments, {
			repositoryId,
			prNumber: args.prNumber,
			reviewComments: [
				{
					githubReviewCommentId: comment.id,
					githubReviewId: comment.pull_request_review_id ?? null,
					inReplyToGithubReviewCommentId: comment.in_reply_to_id ?? null,
					authorUserId: comment.user?.id ?? null,
					body: comment.body,
					path: comment.path ?? null,
					line: comment.line ?? null,
					originalLine: comment.original_line ?? null,
					startLine: comment.start_line ?? null,
					side: comment.side ?? null,
					startSide: comment.start_side ?? null,
					commitSha: comment.commit_id ?? null,
					originalCommitSha: comment.original_commit_id ?? null,
					htmlUrl: comment.html_url ?? null,
					createdAt: isoTimestampToMsOrNow(comment.created_at),
					updatedAt: isoTimestampToMsOrNow(comment.updated_at),
				},
			],
		});

		return { accepted: true, githubReviewCommentId: comment.id };
	}),
);

syncPrFilesDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

		if (args.installationId <= 0) {
			return { fileCount: 0, truncatedPatches: 0 };
		}

		const token = yield* getInstallationToken(args.installationId);
		const ghLayer = GitHubApiClient.fromToken(token);

		// Paginated fetch of PR files
		const allFiles: Array<{
			filename: string;
			status: string;
			additions: number;
			deletions: number;
			changes: number;
			patch?: string | null;
			previous_filename?: string | null;
		}> = [];
		let truncatedPatches = 0;

		let page = 1;
		let hasMore = true;
		while (hasMore && allFiles.length < MAX_FILES_PER_PR) {
			const filesPage = yield* fetchArrayLenient(
				PullRequestFileForSyncSchema,
				HttpClientRequest.get(
					`/repos/${args.ownerLogin}/${args.name}/pulls/${String(args.pullRequestNumber)}/files`,
				).pipe(
					HttpClientRequest.setUrlParams({
						per_page: 100,
						page,
					}),
				),
			).pipe(Effect.provide(ghLayer));

			for (const file of filesPage.items) {
				allFiles.push({
					filename: file.filename,
					status: file.status,
					additions: file.additions,
					deletions: file.deletions,
					changes: file.changes,
					patch: file.patch ?? null,
					previous_filename: file.previous_filename ?? null,
				});
			}
			hasMore = filesPage.items.length === 100;
			page += 1;
		}

		// Map to storage format with patch truncation
		const files = allFiles.slice(0, MAX_FILES_PER_PR).map((f) => {
			let patch = str(f.patch);
			if (
				patch !== null &&
				new TextEncoder().encode(patch).length > MAX_PATCH_BYTES
			) {
				patch = null;
				truncatedPatches++;
			}
			return {
				filename: str(f.filename) ?? "unknown",
				status: toPrFileStatus(f.status),
				additions: num(f.additions),
				deletions: num(f.deletions),
				changes: num(f.changes),
				patch,
				previousFilename: str(f.previous_filename),
			};
		});

		// Persist via internal mutation (batch — may need to chunk for very large PRs)
		// Convex mutations have a size limit, so we chunk into batches of 50 files
		const CHUNK_SIZE = 50;
		for (let i = 0; i < files.length; i += CHUNK_SIZE) {
			const chunk = files.slice(i, i + CHUNK_SIZE);
			yield* ctx.runMutation(internal.rpc.githubActions.upsertPrFiles, {
				repositoryId: args.repositoryId,
				pullRequestNumber: args.pullRequestNumber,
				headSha: args.headSha,
				files: chunk,
			});
		}

		return { fileCount: files.length, truncatedPatches };
	}).pipe(
		Effect.catchAll(() =>
			Effect.succeed({ fileCount: 0, truncatedPatches: 0 }),
		),
	),
);

upsertPrFilesDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();
		let upserted = 0;

		for (const file of args.files) {
			// Check for existing file record by repo/PR/filename
			const existing = yield* ctx.db
				.query("github_pull_request_files")
				.withIndex("by_repositoryId_and_pullRequestNumber_and_filename", (q) =>
					q
						.eq("repositoryId", args.repositoryId)
						.eq("pullRequestNumber", args.pullRequestNumber)
						.eq("filename", file.filename),
				)
				.first();

			const data = {
				repositoryId: args.repositoryId,
				pullRequestNumber: args.pullRequestNumber,
				headSha: args.headSha,
				filename: file.filename,
				status: file.status,
				additions: file.additions,
				deletions: file.deletions,
				changes: file.changes,
				patch: file.patch,
				previousFilename: file.previousFilename,
				cachedAt: now,
			};

			if (Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, data);
			} else {
				yield* ctx.db.insert("github_pull_request_files", data);
			}
			upserted++;
		}

		return { upserted };
	}),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const githubActionsModule = makeRpcModule(
	{
		syncViewerPermissions: syncViewerPermissionsDef,
		syncUserPermissions: syncUserPermissionsDef,
		syncStalePermissions: syncStalePermissionsDef,
		listConnectedRepoIds: listConnectedRepoIdsDef,
		listStalePermissionUserIds: listStalePermissionUserIdsDef,
		upsertUserRepoPermissions: upsertUserRepoPermissionsDef,
		resolveRepositoryIdByName: resolveRepositoryIdByNameDef,
		fetchPrDiff: fetchPrDiffDef,
		fetchWorkflowJobLogs: fetchWorkflowJobLogsDef,
		listRepoAssignees: listRepoAssigneesDef,
		syncPrFiles: syncPrFilesDef,
		upsertPrFiles: upsertPrFilesDef,
		// Actions control plane
		rerunWorkflowRun: rerunWorkflowRunDef,
		rerunFailedJobs: rerunFailedJobsDef,
		cancelWorkflowRun: cancelWorkflowRunDef,
		dispatchWorkflow: dispatchWorkflowDef,
		createPrReviewComment: createPrReviewCommentDef,
		createPrReviewCommentReply: createPrReviewCommentReplyDef,
	},
	{ middlewares: DatabaseRpcModuleMiddlewares },
);

export const {
	syncViewerPermissions,
	syncUserPermissions,
	syncStalePermissions,
	listConnectedRepoIds,
	listStalePermissionUserIds,
	upsertUserRepoPermissions,
	resolveRepositoryIdByName,
	fetchPrDiff,
	fetchWorkflowJobLogs,
	listRepoAssignees,
	syncPrFiles,
	upsertPrFiles,
	rerunWorkflowRun,
	rerunFailedJobs,
	cancelWorkflowRun,
	dispatchWorkflow,
	createPrReviewComment,
	createPrReviewCommentReply,
} = githubActionsModule.handlers;
export { githubActionsModule, NotAuthenticated, ActionsControlError };
export type GithubActionsModule = typeof githubActionsModule;
