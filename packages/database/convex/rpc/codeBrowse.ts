/**
 * Code Browsing — on-demand file tree + content fetching with caching.
 *
 * Endpoints:
 *   - getFileTree (action)        — fetch file tree for a repo at a given ref
 *   - getFileContent (action)     — fetch file content for a specific path at a ref
 *   - upsertTreeCache (internalMutation) — cache tree data
 *   - upsertFileCache (internalMutation) — cache file content
 *   - getCachedTree (internalQuery)      — check tree cache
 *   - getCachedFile (internalQuery)      — check file cache
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
	ContentFile,
	type ReposGetContent200,
} from "../shared/generated_github_client";
import { GitHubApiClient } from "../shared/githubApi";
import { lookupGitHubTokenByUserIdConfect } from "../shared/githubToken";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const TreeEntry = Schema.Struct({
	path: Schema.String,
	mode: Schema.String,
	type: Schema.Literal("blob", "tree", "commit"),
	sha: Schema.String,
	size: Schema.NullOr(Schema.Number),
});

const FileContentResult = Schema.Struct({
	path: Schema.String,
	content: Schema.NullOr(Schema.String),
	sha: Schema.String,
	size: Schema.Number,
	encoding: Schema.NullOr(Schema.String),
});

const FileReadStateItem = Schema.Struct({
	path: Schema.String,
	fileSha: Schema.String,
	readAt: Schema.Number,
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class NotAuthenticated extends Schema.TaggedError<NotAuthenticated>()(
	"NotAuthenticated",
	{ reason: Schema.String },
) {}

class RepoNotFound extends Schema.TaggedError<RepoNotFound>()("RepoNotFound", {
	ownerLogin: Schema.String,
	name: Schema.String,
}) {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

type TreeEntryData = {
	path: string;
	mode: string;
	type: "blob" | "tree" | "commit";
	sha: string;
	size: number | null;
};

const emptyTreeResult = (sha: string) => ({
	sha,
	truncated: false,
	tree: [] satisfies Array<TreeEntryData>,
});

const parseTreeEntryType = (t: string): "blob" | "tree" | "commit" =>
	t === "tree" ? "tree" : t === "commit" ? "commit" : "blob";

type FileContentData = {
	path: string;
	content: string | null;
	sha: string;
	size: number;
	encoding: string | null;
};

/**
 * Extract file content from the reposGetContent union response.
 * Returns null for directory listings, symlinks, and submodules.
 *
 * The reposGetContent endpoint returns a union:
 *   ContentDirectory (readonly array) | ContentFile | ContentSymlink | ContentSubmodule
 *
 * TypeScript's Array.isArray doesn't narrow readonly arrays out of the union,
 * so we validate the Schema against ContentFile to check the type safely.
 */
const isContentFile = Schema.is(ContentFile);

const extractFileContent =
	(fallbackPath: string) =>
	(data: typeof ReposGetContent200.Type): FileContentData | null => {
		// Use Schema.is to validate if this is a ContentFile.
		// Schema.is accepts `unknown` and returns a type predicate, but it doesn't
		// narrow the original union parameter. So we call it and then access the
		// data through a ContentFile-typed binding.
		if (!isContentFile(data)) {
			return null;
		}

		// Schema.is confirmed this is a valid ContentFile.
		// Re-decode to get a properly typed value.
		const file = Schema.decodeUnknownSync(ContentFile)(data);

		const rawContent = file.content;
		const encoding = file.encoding;
		let content: string | null = null;
		if (rawContent && encoding === "base64") {
			// Decode base64 — strip newlines that GitHub inserts
			try {
				content = atob(rawContent.replace(/\n/g, ""));
			} catch {
				content = null;
			}
		} else if (rawContent) {
			content = rawContent;
		}

		return {
			path: file.path ?? fallbackPath,
			content,
			sha: file.sha,
			size: file.size,
			encoding,
		};
	};

// ---------------------------------------------------------------------------
// Endpoint definitions
// ---------------------------------------------------------------------------

/**
 * Get the file tree for a repo at a given ref (SHA or branch name).
 * Caches results in github_tree_cache.
 */
const getFileTreeDef = factory.action({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		sha: Schema.String,
	},
	success: Schema.Struct({
		sha: Schema.String,
		truncated: Schema.Boolean,
		tree: Schema.Array(TreeEntry),
	}),
	error: Schema.Union(NotAuthenticated, RepoNotFound),
});

/**
 * Get file content for a specific path at a ref.
 * Caches results in github_file_cache.
 */
const getFileContentDef = factory.action({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		path: Schema.String,
		ref: Schema.String,
	},
	success: Schema.NullOr(FileContentResult),
	error: Schema.Union(NotAuthenticated, RepoNotFound),
});

/**
 * Internal: upsert tree cache entry.
 */
const upsertTreeCacheDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		sha: Schema.String,
		treeJson: Schema.String,
		truncated: Schema.Boolean,
	},
	success: Schema.Struct({ cached: Schema.Boolean }),
});

/**
 * Internal: upsert file cache entry.
 */
const upsertFileCacheDef = factory.internalMutation({
	payload: {
		repositoryId: Schema.Number,
		sha: Schema.String,
		path: Schema.String,
		content: Schema.NullOr(Schema.String),
		size: Schema.Number,
		encoding: Schema.NullOr(Schema.String),
	},
	success: Schema.Struct({ cached: Schema.Boolean }),
});

/**
 * Internal: check tree cache.
 */
const getCachedTreeDef = factory.internalQuery({
	payload: {
		repositoryId: Schema.Number,
		sha: Schema.String,
	},
	success: Schema.NullOr(
		Schema.Struct({
			treeJson: Schema.String,
			truncated: Schema.Boolean,
		}),
	),
});

/**
 * Internal: check file cache.
 */
const getCachedFileDef = factory.internalQuery({
	payload: {
		repositoryId: Schema.Number,
		sha: Schema.String,
	},
	success: Schema.NullOr(FileContentResult),
});

/**
 * Get read states for all files in a repo tree snapshot.
 */
const getFileReadStateDef = factory.query({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		treeSha: Schema.String,
	},
	success: Schema.Array(FileReadStateItem),
	error: Schema.Union(NotAuthenticated, RepoNotFound),
});

/**
 * Mark a file as read for the current signed-in user.
 */
const markFileReadDef = factory.mutation({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
		treeSha: Schema.String,
		path: Schema.String,
		fileSha: Schema.String,
	},
	success: Schema.Struct({ marked: Schema.Boolean }),
	error: Schema.Union(NotAuthenticated, RepoNotFound),
});

// ---------------------------------------------------------------------------
// Helper: resolve repo + token for actions
// ---------------------------------------------------------------------------

const resolveRepoAndToken = (
	ctx: {
		runQuery: ConfectActionCtx["runQuery"];
	},
	ownerLogin: string,
	name: string,
) =>
	Effect.gen(function* () {
		// Get the repo info
		const repoResult = yield* ctx.runQuery(
			internal.rpc.codeBrowse.getRepoInfo,
			{ ownerLogin, name },
		);
		const RepoInfoSchema = Schema.Struct({
			found: Schema.Boolean,
			repositoryId: Schema.optional(Schema.Number),
			connectedByUserId: Schema.optional(Schema.NullOr(Schema.String)),
			installationId: Schema.optional(Schema.Number),
		});
		const repo = Schema.decodeUnknownSync(RepoInfoSchema)(repoResult);

		if (!repo.found || repo.repositoryId === undefined) {
			return yield* new RepoNotFound({ ownerLogin, name });
		}

		const userId = repo.connectedByUserId;
		if (!userId) {
			return yield* new NotAuthenticated({
				reason: "No connected user for this repository",
			});
		}

		const token = yield* lookupGitHubTokenByUserIdConfect(
			ctx.runQuery,
			userId,
		).pipe(
			Effect.catchTag(
				"NoGitHubTokenError",
				(e) => new NotAuthenticated({ reason: e.reason }),
			),
		);

		return {
			repositoryId: repo.repositoryId,
			installationId: repo.installationId ?? 0,
			token,
		};
	});

/**
 * Resolve acting user from authenticated session.
 */
const getActingUserId = (ctx: {
	auth: {
		getUserIdentity: () => Effect.Effect<Option.Option<{ subject: string }>>;
	};
}): Effect.Effect<string, NotAuthenticated> =>
	Effect.gen(function* () {
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) {
			return yield* new NotAuthenticated({ reason: "User is not signed in" });
		}
		return identity.value.subject;
	});

/**
 * Resolve repository internal id for a public owner/name pair.
 */
const resolveRepositoryByOwnerAndName = (
	ctx: {
		db: ConfectQueryCtx["db"] | ConfectMutationCtx["db"];
	},
	ownerLogin: string,
	name: string,
) =>
	Effect.gen(function* () {
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", ownerLogin).eq("name", name),
			)
			.first();

		if (Option.isNone(repo)) {
			return yield* new RepoNotFound({ ownerLogin, name });
		}

		return { repositoryId: repo.value.githubRepoId };
	});

// ---------------------------------------------------------------------------
// Internal query: get repo info (used by actions)
// ---------------------------------------------------------------------------

const getRepoInfoDef = factory.internalQuery({
	payload: {
		ownerLogin: Schema.String,
		name: Schema.String,
	},
	success: Schema.Struct({
		found: Schema.Boolean,
		repositoryId: Schema.optional(Schema.Number),
		connectedByUserId: Schema.optional(Schema.NullOr(Schema.String)),
		installationId: Schema.optional(Schema.Number),
	}),
});

getRepoInfoDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin).eq("name", args.name),
			)
			.first();

		if (Option.isNone(repo)) return { found: false };

		return {
			found: true,
			repositoryId: repo.value.githubRepoId,
			connectedByUserId: repo.value.connectedByUserId ?? null,
			installationId: repo.value.installationId,
		};
	}),
);

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

getFileTreeDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const { repositoryId, token } = yield* resolveRepoAndToken(
			ctx,
			args.ownerLogin,
			args.name,
		);

		// Check cache
		const cachedResult = yield* ctx.runQuery(
			internal.rpc.codeBrowse.getCachedTree,
			{ repositoryId, sha: args.sha },
		);
		const CachedTreeSchema = Schema.NullOr(
			Schema.Struct({
				treeJson: Schema.String,
				truncated: Schema.Boolean,
			}),
		);
		const cached = Schema.decodeUnknownSync(CachedTreeSchema)(cachedResult);

		if (cached !== null) {
			const parsed: Array<unknown> = JSON.parse(cached.treeJson);
			const treeData = parsed.map((entry) => {
				const e =
					entry !== null && typeof entry === "object"
						? Object.fromEntries(Object.entries(entry))
						: {};
				return {
					path: str(e.path) ?? "",
					mode: str(e.mode) ?? "100644",
					type:
						e.type === "tree"
							? ("tree" as const)
							: e.type === "commit"
								? ("commit" as const)
								: ("blob" as const),
					sha: str(e.sha) ?? "",
					size: num(e.size),
				};
			});
			return {
				sha: args.sha,
				truncated: cached.truncated,
				tree: treeData,
			};
		}

		// Fetch from GitHub
		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		const result = yield* gh.client
			.gitGetTree(args.ownerLogin, args.name, args.sha, {
				recursive: "1",
			})
			.pipe(
				Effect.map((data) => ({
					sha: data.sha,
					truncated: data.truncated,
					tree: data.tree.map((entry) => ({
						path: entry.path,
						mode: entry.mode,
						type: parseTreeEntryType(entry.type),
						sha: entry.sha,
						size: entry.size ?? null,
					})),
				})),
				Effect.catchAll(() => Effect.succeed(emptyTreeResult(args.sha))),
			);

		// Cache the result
		if (result.tree.length > 0) {
			yield* ctx
				.runMutation(internal.rpc.codeBrowse.upsertTreeCache, {
					repositoryId,
					sha: result.sha,
					treeJson: JSON.stringify(result.tree),
					truncated: result.truncated,
				})
				.pipe(Effect.catchAll(() => Effect.void));
		}

		return result;
	}),
);

getFileContentDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const { repositoryId, token } = yield* resolveRepoAndToken(
			ctx,
			args.ownerLogin,
			args.name,
		);

		// Fetch from GitHub (contents endpoint includes the blob SHA)
		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		const result = yield* gh.client
			.reposGetContent(args.ownerLogin, args.name, args.path, {
				ref: args.ref,
			})
			.pipe(
				Effect.map(extractFileContent(args.path)),
				Effect.catchAll(() => Effect.succeed(null)),
			);

		// Cache if we got a result
		if (result !== null && result.sha !== "") {
			yield* ctx
				.runMutation(internal.rpc.codeBrowse.upsertFileCache, {
					repositoryId,
					sha: result.sha,
					path: result.path,
					content: result.content,
					size: result.size,
					encoding: result.encoding,
				})
				.pipe(Effect.catchAll(() => Effect.void));
		}

		return result;
	}),
);

// ---------------------------------------------------------------------------
// Internal mutation implementations
// ---------------------------------------------------------------------------

upsertTreeCacheDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		const existing = yield* ctx.db
			.query("github_tree_cache")
			.withIndex("by_repositoryId_and_sha", (q) =>
				q.eq("repositoryId", args.repositoryId).eq("sha", args.sha),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, {
				treeJson: args.treeJson,
				truncated: args.truncated,
				cachedAt: Date.now(),
			});
		} else {
			yield* ctx.db.insert("github_tree_cache", {
				repositoryId: args.repositoryId,
				sha: args.sha,
				treeJson: args.treeJson,
				truncated: args.truncated,
				cachedAt: Date.now(),
			});
		}

		return { cached: true };
	}),
);

upsertFileCacheDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;

		const existing = yield* ctx.db
			.query("github_file_cache")
			.withIndex("by_repositoryId_and_sha", (q) =>
				q.eq("repositoryId", args.repositoryId).eq("sha", args.sha),
			)
			.first();

		if (Option.isSome(existing)) {
			yield* ctx.db.patch(existing.value._id, {
				path: args.path,
				content: args.content,
				size: args.size,
				encoding: args.encoding,
				cachedAt: Date.now(),
			});
		} else {
			yield* ctx.db.insert("github_file_cache", {
				repositoryId: args.repositoryId,
				sha: args.sha,
				path: args.path,
				content: args.content,
				size: args.size,
				encoding: args.encoding,
				cachedAt: Date.now(),
			});
		}

		return { cached: true };
	}),
);

// ---------------------------------------------------------------------------
// Internal query implementations
// ---------------------------------------------------------------------------

getCachedTreeDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const cached = yield* ctx.db
			.query("github_tree_cache")
			.withIndex("by_repositoryId_and_sha", (q) =>
				q.eq("repositoryId", args.repositoryId).eq("sha", args.sha),
			)
			.first();

		if (Option.isNone(cached)) return null;

		return {
			treeJson: cached.value.treeJson,
			truncated: cached.value.truncated,
		};
	}),
);

getCachedFileDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const cached = yield* ctx.db
			.query("github_file_cache")
			.withIndex("by_repositoryId_and_sha", (q) =>
				q.eq("repositoryId", args.repositoryId).eq("sha", args.sha),
			)
			.first();

		if (Option.isNone(cached)) return null;

		return {
			path: cached.value.path,
			content: cached.value.content,
			sha: cached.value.sha,
			size: cached.value.size,
			encoding: cached.value.encoding,
		};
	}),
);

getFileReadStateDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const userId = yield* getActingUserId(ctx);
		const repo = yield* resolveRepositoryByOwnerAndName(
			ctx,
			args.ownerLogin,
			args.name,
		);

		const states = yield* ctx.db
			.query("github_file_read_state")
			.withIndex("by_userId_and_repositoryId_and_treeSha", (q) =>
				q
					.eq("userId", userId)
					.eq("repositoryId", repo.repositoryId)
					.eq("treeSha", args.treeSha),
			)
			.collect();

		return states.map((state) => ({
			path: state.path,
			fileSha: state.fileSha,
			readAt: state.readAt,
		}));
	}),
);

markFileReadDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const userId = yield* getActingUserId(ctx);
		const repo = yield* resolveRepositoryByOwnerAndName(
			ctx,
			args.ownerLogin,
			args.name,
		);

		const rows = yield* ctx.db
			.query("github_file_read_state")
			.withIndex("by_userId_and_repositoryId_and_treeSha", (q) =>
				q
					.eq("userId", userId)
					.eq("repositoryId", repo.repositoryId)
					.eq("treeSha", args.treeSha),
			)
			.collect();

		const existing = rows.find(
			(state) => state.path === args.path && state.fileSha === args.fileSha,
		);

		const now = Date.now();
		if (existing) {
			yield* ctx.db.patch(existing._id, {
				readAt: now,
				path: args.path,
				fileSha: args.fileSha,
			});
			return { marked: false };
		}

		yield* ctx.db.insert("github_file_read_state", {
			userId,
			repositoryId: repo.repositoryId,
			treeSha: args.treeSha,
			path: args.path,
			fileSha: args.fileSha,
			readAt: now,
		});

		return { marked: true };
	}),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const codeBrowseModule = makeRpcModule(
	{
		getFileTree: getFileTreeDef,
		getFileContent: getFileContentDef,
		upsertTreeCache: upsertTreeCacheDef,
		upsertFileCache: upsertFileCacheDef,
		getCachedTree: getCachedTreeDef,
		getCachedFile: getCachedFileDef,
		getFileReadState: getFileReadStateDef,
		markFileRead: markFileReadDef,
		getRepoInfo: getRepoInfoDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const {
	getFileTree,
	getFileContent,
	upsertTreeCache,
	upsertFileCache,
	getCachedTree,
	getCachedFile,
	getFileReadState,
	markFileRead,
	getRepoInfo,
} = codeBrowseModule.handlers;
export { codeBrowseModule };
export type CodeBrowseModule = typeof codeBrowseModule;
