import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import {
	ConfectActionCtx,
	ConfectMutationCtx,
	confectSchema,
} from "../confect";
import { GitHubApiClient, GitHubApiError } from "../shared/githubApi";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parseNextLink = (linkHeader: string | null): string | null => {
	if (!linkHeader) return null;
	const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
	return matches?.[1] ?? null;
};

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

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

fetchPrDiffDef.implement((args) =>
	Effect.gen(function* () {
		const github = yield* GitHubApiClient;
		const diff = yield* github.use(async (fetch) => {
			const res = await fetch(
				`/repos/${args.ownerLogin}/${args.name}/pulls/${args.number}`,
				{
					headers: { Accept: "application/vnd.github.diff" },
				},
			);
			if (res.status === 404) return null;
			if (!res.ok) {
				throw new Error(
					`GitHub API returned ${res.status}: ${await res.text()}`,
				);
			}
			return res.text();
		});
		return diff;
	}).pipe(
		Effect.catchAll(() => Effect.succeed(null)),
		Effect.provide(GitHubApiClient.Live),
	),
);

syncPrFilesDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const gh = yield* GitHubApiClient;

		// Paginated fetch of PR files
		const allFiles: Array<Record<string, unknown>> = [];
		let truncatedPatches = 0;

		yield* gh.use(async (fetch) => {
			let url: string | null =
				`/repos/${args.ownerLogin}/${args.name}/pulls/${args.pullRequestNumber}/files?per_page=100`;

			while (url && allFiles.length < MAX_FILES_PER_PR) {
				const res = await fetch(url);
				if (res.status === 404) return;
				if (!res.ok) {
					throw new GitHubApiError({
						status: res.status,
						message: await res.text(),
						url: res.url,
					});
				}

				const page = (await res.json()) as Array<Record<string, unknown>>;
				allFiles.push(...page);
				url = parseNextLink(res.headers.get("link"));
			}
		});

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
		Effect.provide(GitHubApiClient.Live),
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

// We need to reference internal for the action→mutation call
import { internal } from "../_generated/api";

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const githubActionsModule = makeRpcModule(
	{
		fetchPrDiff: fetchPrDiffDef,
		syncPrFiles: syncPrFilesDef,
		upsertPrFiles: upsertPrFilesDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const { fetchPrDiff, syncPrFiles, upsertPrFiles } =
	githubActionsModule.handlers;
export { githubActionsModule };
export type GithubActionsModule = typeof githubActionsModule;
