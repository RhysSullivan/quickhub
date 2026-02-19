/**
 * repoOnboard — Public action for adding a repo from a URL.
 *
 * Flow:
 *   1. Parse GitHub URL → owner/name
 *   2. Fetch repo metadata from GitHub API
 *   3. Check if the PAT owner has admin access (for webhook setup)
 *   4. If admin → create a webhook on the repo
 *   5. Insert repo + installation records + schedule bootstrap
 *
 * This is a single public action because it needs to call GitHub API
 * (action) AND then write to the DB (via internal mutation).
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
import { GitHubApiClient, GitHubApiError } from "../shared/githubApi";
import { updateRepoOverview } from "../shared/projections";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class InvalidRepoUrl extends Schema.TaggedError<InvalidRepoUrl>()(
	"InvalidRepoUrl",
	{ input: Schema.String, reason: Schema.String },
) {}

class RepoNotFound extends Schema.TaggedError<RepoNotFound>()("RepoNotFound", {
	fullName: Schema.String,
}) {}

class AlreadyConnected extends Schema.TaggedError<AlreadyConnected>()(
	"AlreadyConnected",
	{ fullName: Schema.String },
) {}

class WebhookSetupFailed extends Schema.TaggedError<WebhookSetupFailed>()(
	"WebhookSetupFailed",
	{ fullName: Schema.String, reason: Schema.String },
) {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract `owner/name` from various GitHub URL formats:
 * - `https://github.com/owner/name`
 * - `https://github.com/owner/name/...anything`
 * - `github.com/owner/name`
 * - `owner/name`
 */
const parseRepoFullName = (input: string): string | null => {
	const trimmed = input.trim();

	// Try URL parsing first
	if (
		trimmed.includes("github.com/") ||
		trimmed.startsWith("http://") ||
		trimmed.startsWith("https://")
	) {
		const withProtocol = trimmed.startsWith("http")
			? trimmed
			: `https://${trimmed}`;
		try {
			const url = new URL(withProtocol);
			const parts = url.pathname.split("/").filter(Boolean);
			if (parts.length >= 2) {
				return `${parts[0]}/${parts[1]}`;
			}
		} catch {
			// Fall through to direct parsing
		}
	}

	// Direct owner/name format
	const match = trimmed.match(/^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/);
	if (match) {
		return `${match[1]}/${match[2]}`;
	}

	return null;
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const bool = (v: unknown): boolean => v === true;

// ---------------------------------------------------------------------------
// Internal mutation: insert repo records + schedule bootstrap
// ---------------------------------------------------------------------------

const insertRepoAndBootstrapDef = factory.internalMutation({
	payload: {
		fullName: Schema.String,
		githubRepoId: Schema.Number,
		ownerId: Schema.Number,
		ownerLogin: Schema.String,
		ownerType: Schema.Literal("User", "Organization"),
		name: Schema.String,
		defaultBranch: Schema.String,
		visibility: Schema.Literal("public", "private", "internal"),
		isPrivate: Schema.Boolean,
		webhookSetup: Schema.Boolean,
	},
	success: Schema.Struct({
		repositoryId: Schema.Number,
		bootstrapScheduled: Schema.Boolean,
	}),
});

insertRepoAndBootstrapDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();

		// Find or create installation record for the owner
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
				accountId: args.ownerId,
				accountLogin: args.ownerLogin,
				accountType: args.ownerType,
				suspendedAt: null,
				permissionsDigest: "",
				eventsDigest: "",
				updatedAt: now,
			});
		}

		// Create repository record
		yield* ctx.db.insert("github_repositories", {
			githubRepoId: args.githubRepoId,
			installationId,
			ownerId: args.ownerId,
			ownerLogin: args.ownerLogin,
			name: args.name,
			fullName: args.fullName,
			private: args.isPrivate,
			visibility: args.visibility,
			defaultBranch: args.defaultBranch,
			archived: false,
			disabled: false,
			fork: false,
			pushedAt: null,
			githubUpdatedAt: now,
			cachedAt: now,
		});

		// Create sync job
		const lockKey = `repo-bootstrap:${installationId}:${args.githubRepoId}`;

		const existingJob = yield* ctx.db
			.query("github_sync_jobs")
			.withIndex("by_lockKey", (q) => q.eq("lockKey", lockKey))
			.first();

		let bootstrapScheduled = false;

		if (Option.isNone(existingJob)) {
			yield* ctx.db.insert("github_sync_jobs", {
				jobType: "backfill",
				scopeType: "repository",
				triggerReason: "repo_added",
				lockKey,
				installationId,
				repositoryId: args.githubRepoId,
				entityType: null,
				state: "pending",
				attemptCount: 0,
				nextRunAt: now,
				lastError: null,
				createdAt: now,
				updatedAt: now,
			});

			// Schedule bootstrap action
			yield* Effect.promise(() =>
				ctx.scheduler.runAfter(0, internal.rpc.repoBootstrap.bootstrapRepo, {
					githubRepoId: args.githubRepoId,
					fullName: args.fullName,
					lockKey,
				}),
			);
			bootstrapScheduled = true;
		}

		// Create the initial view_repo_overview row so the repo appears
		// in the dashboard immediately (with zeroed-out counts). The
		// bootstrap will refresh it again once data is synced.
		yield* updateRepoOverview(args.githubRepoId).pipe(Effect.ignoreLogged);

		return {
			repositoryId: args.githubRepoId,
			bootstrapScheduled,
		};
	}),
);

// ---------------------------------------------------------------------------
// Internal query: check if repo already connected
// ---------------------------------------------------------------------------

const isRepoConnectedDef = factory.internalQuery({
	payload: { githubRepoId: Schema.Number },
	success: Schema.Boolean,
});

isRepoConnectedDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const existing = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) =>
				q.eq("githubRepoId", args.githubRepoId),
			)
			.first();
		return Option.isSome(existing);
	}),
);

// ---------------------------------------------------------------------------
// Public action: addRepoByUrl
// ---------------------------------------------------------------------------

const addRepoByUrlDef = factory.action({
	payload: {
		/** GitHub URL or owner/name string */
		url: Schema.String,
	},
	success: Schema.Struct({
		fullName: Schema.String,
		repositoryId: Schema.Number,
		webhookCreated: Schema.Boolean,
		bootstrapScheduled: Schema.Boolean,
	}),
	error: Schema.Union(
		InvalidRepoUrl,
		RepoNotFound,
		AlreadyConnected,
		WebhookSetupFailed,
	),
});

addRepoByUrlDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const gh = yield* GitHubApiClient;

		// 1. Parse URL → owner/name
		const fullName = parseRepoFullName(args.url);
		if (!fullName) {
			return yield* new InvalidRepoUrl({
				input: args.url,
				reason: "Could not extract owner/name from input",
			});
		}

		// 2. Fetch repo metadata from GitHub API
		const repoData = yield* gh
			.use(async (fetch) => {
				const res = await fetch(`/repos/${fullName}`);
				if (res.status === 404) {
					return null;
				}
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
				Effect.catchTag("GitHubApiError", (e) =>
					Effect.die(`GitHub API error: ${e.status} ${e.message}`),
				),
			);

		if (repoData === null) {
			return yield* new RepoNotFound({ fullName });
		}

		const githubRepoId = num(repoData.id);
		if (githubRepoId === null) {
			return yield* new RepoNotFound({ fullName });
		}

		// 3. Check if already connected
		const connected = yield* ctx.runQuery(
			internal.rpc.repoOnboard.isRepoConnected,
			{ githubRepoId },
		);

		if (connected) {
			return yield* new AlreadyConnected({ fullName });
		}

		// 4. Extract repo metadata
		const owner = repoData.owner as Record<string, unknown> | null;
		const ownerId = num(owner?.id) ?? 0;
		const ownerLogin = str(owner?.login) ?? fullName.split("/")[0] ?? "";
		const ownerTypeRaw = str(owner?.type);
		const ownerType: "User" | "Organization" =
			ownerTypeRaw === "Organization" ? "Organization" : "User";
		const name = str(repoData.name) ?? fullName.split("/")[1] ?? "";
		const defaultBranch = str(repoData.default_branch) ?? "main";
		const isPrivate = bool(repoData.private);
		const visibility = isPrivate ? "private" : "public";

		// 5. Check if we have admin access (to set up webhooks)
		// The "permissions" field is only present when using a token that has access
		const permissions = repoData.permissions as
			| Record<string, boolean>
			| undefined;
		const hasAdmin = permissions?.admin === true;

		let webhookCreated = false;

		if (hasAdmin) {
			// 6. Set up webhook
			const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
			const convexSiteUrl = process.env.CONVEX_SITE_URL;

			if (webhookSecret && convexSiteUrl) {
				const webhookUrl = `${convexSiteUrl}/api/github/webhook`;

				const setupResult = yield* gh
					.use(async (fetch) => {
						const res = await fetch(`/repos/${fullName}/hooks`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								name: "web",
								active: true,
								events: [
									"push",
									"pull_request",
									"pull_request_review",
									"issues",
									"issue_comment",
									"check_run",
									"create",
									"delete",
								],
								config: {
									url: webhookUrl,
									content_type: "json",
									secret: webhookSecret,
									insecure_ssl: "0",
								},
							}),
						});

						if (!res.ok) {
							const body = await res.text();
							// 422 means webhook already exists — that's OK
							if (res.status === 422 && body.includes("already exists")) {
								return { created: false, alreadyExists: true };
							}
							return {
								created: false,
								alreadyExists: false,
								error: `${res.status}: ${body}`,
							};
						}
						return { created: true, alreadyExists: false };
					})
					.pipe(
						Effect.catchTag("GitHubApiError", (e) =>
							Effect.succeed({
								created: false,
								alreadyExists: false,
								error: e.message,
							}),
						),
					);

				if (
					setupResult.created ||
					("alreadyExists" in setupResult && setupResult.alreadyExists)
				) {
					webhookCreated = true;
				} else if ("error" in setupResult && setupResult.error) {
					console.warn(
						`Webhook setup failed for ${fullName}: ${setupResult.error}. Continuing with sync-only.`,
					);
				}
			}
		}

		// 7. Insert repo records + schedule bootstrap
		const insertResult = yield* ctx.runMutation(
			internal.rpc.repoOnboard.insertRepoAndBootstrap,
			{
				fullName,
				githubRepoId,
				ownerId,
				ownerLogin,
				ownerType,
				name,
				defaultBranch,
				visibility,
				isPrivate,
				webhookSetup: webhookCreated,
			},
		);

		// Decode the result through Schema for type safety
		// (ctx.runMutation returns unknown at the type level due to Convex codegen limitations)
		const InsertResultSchema = Schema.Struct({
			repositoryId: Schema.Number,
			bootstrapScheduled: Schema.Boolean,
		});
		const decoded = Schema.decodeUnknownSync(InsertResultSchema)(insertResult);

		return {
			fullName,
			repositoryId: decoded.repositoryId,
			webhookCreated,
			bootstrapScheduled: decoded.bootstrapScheduled,
		};
	}).pipe(Effect.provide(GitHubApiClient.Live)),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const repoOnboardModule = makeRpcModule(
	{
		addRepoByUrl: addRepoByUrlDef,
		insertRepoAndBootstrap: insertRepoAndBootstrapDef,
		isRepoConnected: isRepoConnectedDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const { addRepoByUrl, insertRepoAndBootstrap, isRepoConnected } =
	repoOnboardModule.handlers;
export {
	repoOnboardModule,
	InvalidRepoUrl,
	RepoNotFound,
	AlreadyConnected,
	WebhookSetupFailed,
};
export type RepoOnboardModule = typeof repoOnboardModule;
