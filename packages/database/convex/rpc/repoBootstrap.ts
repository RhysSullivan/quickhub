/**
 * repoBootstrap — DEFINITION ONLY.
 *
 * This file defines the RPC endpoint schemas and exports the Convex function
 * registrations. It must NOT import `internal` from `_generated/api` to avoid
 * a circular type dependency (api.d.ts deeply resolves every exported function
 * in every file it imports).
 *
 * The actual handler implementation lives in `repoBootstrapImpl.ts`, which
 * imports `internal` safely because it exports no Convex functions itself.
 */
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Schema } from "effect";
import { confectSchema } from "../confect";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Endpoint definition — schema only, no handler
// ---------------------------------------------------------------------------

/**
 * Bootstrap a newly-connected repository by fetching branches,
 * pull requests, and issues from the GitHub REST API, then writing
 * them into Convex via internal mutations.
 *
 * Called as a scheduled action from `connectRepo`.
 */
export const bootstrapRepoDef = factory.internalAction({
	payload: {
		githubRepoId: Schema.Number,
		fullName: Schema.String,
		lockKey: Schema.String,
		/** better-auth user ID whose GitHub OAuth token should be used. */
		connectedByUserId: Schema.String,
	},
	success: Schema.Struct({
		branches: Schema.Number,
		pullRequests: Schema.Number,
		issues: Schema.Number,
		commits: Schema.Number,
		checkRuns: Schema.Number,
		users: Schema.Number,
	}),
});

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const repoBootstrapModule = makeRpcModule(
	{
		bootstrapRepo: bootstrapRepoDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const { bootstrapRepo } = repoBootstrapModule.handlers;
export { repoBootstrapModule };
export type RepoBootstrapModule = typeof repoBootstrapModule;

// ---------------------------------------------------------------------------
// Wire implementations at module load time.
// This import has NO exports that Convex's api.d.ts would resolve, so it
// breaks the circular dependency chain.
// ---------------------------------------------------------------------------
import "./repoBootstrapImpl";
