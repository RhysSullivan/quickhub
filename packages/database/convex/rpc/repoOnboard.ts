/**
 * repoOnboard — internal repository onboarding helpers.
 */
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { internal } from "../_generated/api";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";
import { DatabaseRpcModuleMiddlewares } from "./moduleMiddlewares";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
		stargazersCount: Schema.optional(Schema.Number),
		webhookSetup: Schema.Boolean,
		/** The better-auth user ID of whoever connected this repo. */
		connectedByUserId: Schema.NullOr(Schema.String),
		/** GitHub user ID of the connecting user (if known). */
		connectedByGithubUserId: Schema.NullOr(Schema.Number),
		permissionPull: Schema.Boolean,
		permissionTriage: Schema.Boolean,
		permissionPush: Schema.Boolean,
		permissionMaintain: Schema.Boolean,
		permissionAdmin: Schema.Boolean,
		permissionRoleName: Schema.NullOr(Schema.String),
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
			connectedByUserId: args.connectedByUserId,
			stargazersCount: args.stargazersCount ?? 0,
		});

		if (
			args.connectedByUserId !== null &&
			args.connectedByGithubUserId !== null
		) {
			const existingPermission = yield* ctx.db
				.query("github_user_repo_permissions")
				.withIndex("by_userId_and_repositoryId", (q) =>
					q
						.eq("userId", args.connectedByUserId)
						.eq("repositoryId", args.githubRepoId),
				)
				.first();

			const permissionData = {
				userId: args.connectedByUserId,
				repositoryId: args.githubRepoId,
				githubUserId: args.connectedByGithubUserId,
				pull: args.permissionPull,
				triage: args.permissionTriage,
				push: args.permissionPush,
				maintain: args.permissionMaintain,
				admin: args.permissionAdmin,
				roleName: args.permissionRoleName,
				syncedAt: now,
			};

			if (Option.isSome(existingPermission)) {
				yield* ctx.db.patch(existingPermission.value._id, permissionData);
			} else {
				yield* ctx.db.insert("github_user_repo_permissions", permissionData);
			}
		}

		// Create sync job
		const lockKey = `repo-bootstrap:${installationId}:${args.githubRepoId}`;

		const existingJob = yield* ctx.db
			.query("github_sync_jobs")
			.withIndex("by_lockKey", (q) => q.eq("lockKey", lockKey))
			.first();

		let bootstrapScheduled = false;

		if (Option.isNone(existingJob)) {
			const prioritySortKey = -(args.stargazersCount ?? 0);
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
				currentStep: null,
				completedSteps: [],
				itemsFetched: 0,
				prioritySortKey,
				createdAt: now,
				updatedAt: now,
			});

			// Start durable bootstrap workflow (requires at least one token source)
			if (args.connectedByUserId !== null || installationId > 0) {
				yield* ctx.runMutation(internal.rpc.bootstrapWorkflow.startBootstrap, {
					repositoryId: args.githubRepoId,
					fullName: args.fullName,
					lockKey,
					connectedByUserId: args.connectedByUserId,
					installationId,
				});
			}
			bootstrapScheduled = true;
		}

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
// Module
// ---------------------------------------------------------------------------

const repoOnboardModule = makeRpcModule(
	{
		insertRepoAndBootstrap: insertRepoAndBootstrapDef,
		isRepoConnected: isRepoConnectedDef,
	},
	{ middlewares: DatabaseRpcModuleMiddlewares },
);

export const { insertRepoAndBootstrap, isRepoConnected } =
	repoOnboardModule.handlers;
export { repoOnboardModule };
export type RepoOnboardModule = typeof repoOnboardModule;
