import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Either, Option, Schema } from "effect";
import { components, internal } from "../_generated/api";
import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	confectSchema,
} from "../confect";
import { GitHubApiClient } from "../shared/githubApi";
import { getInstallationToken } from "../shared/githubApp";
import { lookupGitHubTokenByUserIdConfect } from "../shared/githubToken";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

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

const toPrFileStatus = (v: unknown): PrFileStatus => {
	const s = typeof v === "string" ? v : "";
	if (PR_FILE_STATUS.includes(s as PrFileStatus)) return s as PrFileStatus;
	return "changed";
};

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

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

// ---------------------------------------------------------------------------
// Endpoint definitions
// ---------------------------------------------------------------------------

/**
 * Fetch the unified diff for a pull request from the GitHub API.
 * Returns raw unified diff text (or null on 404/error).
 */
const fetchPrDiffDef = factory.action({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		number: Schema.Number,
	},
	success: Schema.NullOr(Schema.String),
});

/**
 * Fetch workflow job logs on demand from GitHub.
 *
 * Uses the signed-in user's OAuth token and returns log text directly.
 * Returns null when logs are unavailable or the user cannot access them.
 */
const fetchWorkflowJobLogsDef = factory.action({
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
});

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
		/** better-auth user ID whose GitHub OAuth token should be used. Null for App-installed repos. */
		connectedByUserId: Schema.NullOr(Schema.String),
		/** GitHub App installation ID for fallback token resolution. */
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
	},
	success: Schema.Struct({
		upsertedRepoCount: Schema.Number,
		deletedRepoCount: Schema.Number,
	}),
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
		const ctx = yield* ConfectActionCtx;
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) return null;

		const token = yield* lookupGitHubTokenByUserIdConfect(
			ctx.runQuery,
			identity.value.subject,
		);
		const github = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		const request = HttpClientRequest.setHeader(
			HttpClientRequest.get(
				`/repos/${args.ownerLogin}/${args.name}/pulls/${args.number}`,
			),
			"accept",
			"application/vnd.github.diff",
		);
		const response = yield* github.httpClient.execute(request);
		if (response.status === 404) return null;
		if (response.status < 200 || response.status >= 300) {
			const errorBody = yield* Effect.orElseSucceed(response.text, () => "");
			return yield* Effect.fail(
				new Error(`GitHub API returned ${response.status}: ${errorBody}`),
			);
		}
		const diff = yield* response.text;
		return diff;
	}).pipe(Effect.catchAll(() => Effect.succeed(null))),
);

fetchWorkflowJobLogsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) return null;

		const token = yield* lookupGitHubTokenByUserIdConfect(
			ctx.runQuery,
			identity.value.subject,
		);
		const github = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		const response = yield* github.httpClient.execute(
			HttpClientRequest.get(
				`/repos/${args.ownerLogin}/${args.name}/actions/jobs/${args.jobId}/logs`,
			),
		);

		if (response.status === 404) return null;
		if (response.status < 200 || response.status >= 300) {
			const errorBody = yield* Effect.orElseSucceed(response.text, () => "");
			return yield* Effect.fail(
				new Error(`GitHub API returned ${response.status}: ${errorBody}`),
			);
		}

		const text = yield* response.text;
		if (text.trim() === "") return null;

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

syncPrFilesDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

		// Resolve the GitHub token — try user OAuth first, fall back to installation token
		let token: string;
		if (args.connectedByUserId) {
			token = yield* lookupGitHubTokenByUserIdConfect(
				ctx.runQuery,
				args.connectedByUserId,
			);
		} else if (args.installationId > 0) {
			token = yield* getInstallationToken(args.installationId);
		} else {
			return { fileCount: 0, truncatedPatches: 0 };
		}
		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

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
			const filesPage = yield* gh.client.pullsListFiles(
				args.ownerLogin,
				args.name,
				String(args.pullRequestNumber),
				{
					per_page: 100,
					page,
				},
			);
			for (const file of filesPage) {
				allFiles.push({
					filename: file.filename,
					status: file.status,
					additions: file.additions,
					deletions: file.deletions,
					changes: file.changes,
					patch: file.patch,
					previous_filename: file.previous_filename,
				});
			}
			hasMore = filesPage.length === 100;
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
		fetchPrDiff: fetchPrDiffDef,
		fetchWorkflowJobLogs: fetchWorkflowJobLogsDef,
		syncPrFiles: syncPrFilesDef,
		upsertPrFiles: upsertPrFilesDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const {
	syncViewerPermissions,
	syncUserPermissions,
	syncStalePermissions,
	listConnectedRepoIds,
	listStalePermissionUserIds,
	upsertUserRepoPermissions,
	fetchPrDiff,
	fetchWorkflowJobLogs,
	syncPrFiles,
	upsertPrFiles,
} = githubActionsModule.handlers;
export { githubActionsModule };
export type GithubActionsModule = typeof githubActionsModule;
