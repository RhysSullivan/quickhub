import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { internal } from "../_generated/api";
import { ConfectMutationCtx, confectSchema } from "../confect";
import { DatabaseRpcModuleMiddlewares } from "./moduleMiddlewares";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class RepoAlreadyConnected extends Schema.TaggedError<RepoAlreadyConnected>()(
	"RepoAlreadyConnected",
	{
		fullName: Schema.String,
		githubRepoId: Schema.Number,
	},
) {}

class InvalidRepoFormat extends Schema.TaggedError<InvalidRepoFormat>()(
	"InvalidRepoFormat",
	{ input: Schema.String },
) {}

// ---------------------------------------------------------------------------
// Endpoint Definitions
// ---------------------------------------------------------------------------

/**
 * Connect a GitHub repository to FasterGH.
 *
 * Creates or finds an installation record for the owner account,
 * creates the repository record, creates a bootstrap sync job,
 * and schedules the bootstrap action.
 *
 * Idempotent: if the repo is already connected, returns an error.
 */
const connectRepoDef = factory.internalMutation({
	payload: {
		/** Full repo name, e.g. "RhysSullivan/fastergh-test" */
		fullName: Schema.String,
		/** GitHub repo ID (from API) */
		githubRepoId: Schema.Number,
		/** Owner's GitHub user/org ID */
		ownerId: Schema.Number,
		/** Owner login */
		ownerLogin: Schema.String,
		/** Whether the owner is an org */
		ownerType: Schema.Literal("User", "Organization"),
		/** Repo name (without owner prefix) */
		name: Schema.String,
		/** Default branch name */
		defaultBranch: Schema.String,
		/** Visibility */
		visibility: Schema.Literal("public", "private", "internal"),
		/** Is private? */
		isPrivate: Schema.Boolean,
		/** Current GitHub stargazer count, when known. */
		stargazersCount: Schema.optional(Schema.Number),
		/** The better-auth user ID of whoever connected this repo. */
		connectedByUserId: Schema.NullOr(Schema.String),
	},
	success: Schema.Struct({
		repositoryId: Schema.Number,
		syncJobId: Schema.String,
		bootstrapScheduled: Schema.Boolean,
	}),
	error: Schema.Union(RepoAlreadyConnected, InvalidRepoFormat),
});

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

connectRepoDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const now = Date.now();

		// Validate format
		if (!args.fullName.includes("/")) {
			return yield* new InvalidRepoFormat({ input: args.fullName });
		}

		// Check if repo already connected
		const existingRepo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) =>
				q.eq("githubRepoId", args.githubRepoId),
			)
			.first();

		if (Option.isSome(existingRepo)) {
			return yield* new RepoAlreadyConnected({
				fullName: args.fullName,
				githubRepoId: args.githubRepoId,
			});
		}

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
			connectedByUserId: args.connectedByUserId,
			stargazersCount: args.stargazersCount ?? 0,
		});

		// Create sync job (with dedup lockKey)
		const lockKey = `repo-bootstrap:${installationId}:${args.githubRepoId}`;

		const existingJob = yield* ctx.db
			.query("github_sync_jobs")
			.withIndex("by_lockKey", (q) => q.eq("lockKey", lockKey))
			.first();

		let syncJobId = "";
		let bootstrapScheduled = false;

		if (Option.isNone(existingJob)) {
			const prioritySortKey = -(args.stargazersCount ?? 0);
			const jobId = yield* ctx.db.insert("github_sync_jobs", {
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
				prioritySortKey,
				createdAt: now,
				updatedAt: now,
			});

			syncJobId = String(jobId);

			// Start durable bootstrap workflow (requires at least one token source)
			if (args.connectedByUserId !== null || installationId > 0) {
				yield* ctx.runMutation(internal.rpc.bootstrapWorkflow.startBootstrap, {
					repositoryId: args.githubRepoId,
					fullName: args.fullName,
					lockKey,
					connectedByUserId: args.connectedByUserId,
					installationId,
				});
				bootstrapScheduled = true;
			}
		} else {
			syncJobId = String(existingJob.value._id);
		}

		if (args.connectedByUserId !== null) {
			yield* Effect.promise(() =>
				ctx.scheduler.runAfter(
					0,
					internal.rpc.githubActions.syncUserPermissions,
					{
						userId: args.connectedByUserId,
					},
				),
			).pipe(Effect.ignoreLogged);
		}

		return {
			repositoryId: args.githubRepoId,
			syncJobId,
			bootstrapScheduled,
		};
	}),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const repoConnectModule = makeRpcModule(
	{
		connectRepo: connectRepoDef,
	},
	{ middlewares: DatabaseRpcModuleMiddlewares },
);

export const { connectRepo } = repoConnectModule.handlers;
export { repoConnectModule, RepoAlreadyConnected, InvalidRepoFormat };
export type RepoConnectModule = typeof repoConnectModule;
