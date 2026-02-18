/**
 * Tests for the RPC client subscription flow.
 *
 * Exercises the full chain: convex-test → Confect RPC → createRpcClient → Atom subscription
 * This is what the UI does, so if this works the UI should work too.
 */

import { describe, expect, it } from "@effect/vitest";
import { Atom, Registry, Result } from "@effect-atom/atom";
import { createRpcClient } from "@packages/confect/rpc";
import { ConvexClientTestLayer } from "@packages/confect/testing";
import { Effect, Option } from "effect";
import { api } from "./convex/_generated/api";
import type { ProjectionQueriesModule } from "./convex/rpc/projectionQueries";
import { createConvexTest } from "./testing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ExitEncoded = { _tag: string; value?: unknown; cause?: unknown };

const assertSuccess = (result: unknown): unknown => {
	const exit = result as ExitEncoded;
	if (exit._tag !== "Success") {
		throw new Error(
			`Expected Success, got ${exit._tag}: ${JSON.stringify(exit.cause)}`,
		);
	}
	return exit.value;
};

/** Seed a repo + projection data so listRepos returns something */
const seedRepoData = async (t: ReturnType<typeof createConvexTest>) => {
	const now = Date.now();
	await t.run(async (ctx) => {
		await ctx.db.insert("github_repositories", {
			githubRepoId: 12345,
			installationId: 0,
			ownerId: 999,
			ownerLogin: "testowner",
			name: "testrepo",
			fullName: "testowner/testrepo",
			private: false,
			visibility: "public",
			defaultBranch: "main",
			archived: false,
			disabled: false,
			fork: false,
			pushedAt: now,
			githubUpdatedAt: now,
			cachedAt: now,
		});
		await ctx.db.insert("view_repo_overview", {
			repositoryId: 12345,
			fullName: "testowner/testrepo",
			ownerLogin: "testowner",
			name: "testrepo",
			openPrCount: 3,
			openIssueCount: 5,
			failingCheckCount: 1,
			lastPushAt: now,
			syncLagSeconds: null,
			updatedAt: now,
		});
	});
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RPC Client Subscription Flow", () => {
	it.effect("raw convex-test onUpdate fires with projection data", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			yield* Effect.promise(() => seedRepoData(t));

			// Direct query works
			const directResult = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listRepos, {}),
			);
			const repos = assertSuccess(directResult);
			expect(repos).toBeInstanceOf(Array);
			expect((repos as Array<unknown>).length).toBe(1);

			// onUpdate fires
			const updateResult = yield* Effect.promise<unknown>(
				() =>
					new Promise((resolve, reject) => {
						const timeout = setTimeout(
							() => reject(new Error("onUpdate never fired")),
							5000,
						);
						t.onUpdate(api.rpc.projectionQueries.listRepos, {}, (result) => {
							clearTimeout(timeout);
							resolve(result);
						});
					}),
			);
			const updateRepos = assertSuccess(updateResult);
			expect(updateRepos).toBeInstanceOf(Array);
			expect((updateRepos as Array<unknown>).length).toBe(1);
		}),
	);

	it.effect("ConvexClientTestLayer subscribe stream emits data", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			yield* Effect.promise(() => seedRepoData(t));

			const layer = ConvexClientTestLayer(t);

			// Use the subscribe method from the layer
			const result = yield* Effect.provide(
				Effect.gen(function* () {
					const { ConvexClient } = yield* Effect.promise(
						() => import("@packages/confect/client"),
					);
					const client = yield* ConvexClient;
					const stream = client.subscribe(
						api.rpc.projectionQueries.listRepos,
						{},
					);
					// Take the first emission
					const { Stream } = yield* Effect.promise(() => import("effect"));
					return yield* Stream.runHead(stream);
				}),
				layer,
			);

			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				const repos = assertSuccess(result.value);
				expect((repos as Array<unknown>).length).toBe(1);
			}
		}),
	);

	it.effect("createRpcClient subscription atom resolves to data", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			yield* Effect.promise(() => seedRepoData(t));

			const layer = ConvexClientTestLayer(t);

			// Create an RPC client like the UI does
			const client = createRpcClient<ProjectionQueriesModule>(
				api.rpc.projectionQueries,
				{
					url: "unused-in-test",
					layer,
					enablePayloadTelemetryFallback: false,
				},
			);

			// Create the subscription atom like the page does
			const reposAtom = client.listRepos.subscription({});

			// Create a registry and mount the atom
			const registry = Registry.make({
				runtime: client.runtime,
			});

			// Get the initial value (should be Result.initial)
			const initialValue = registry.get(reposAtom);
			console.log("[test] initial value:", JSON.stringify(initialValue));

			// Mount the atom to start the subscription
			const unmount = registry.mount(reposAtom);

			// Wait for the subscription to emit data
			const finalValue = yield* Effect.promise<unknown>(
				() =>
					new Promise((resolve, reject) => {
						const timeout = setTimeout(() => {
							const current = registry.get(reposAtom);
							console.log("[test] TIMEOUT value:", JSON.stringify(current));
							reject(
								new Error(
									`Subscription never resolved. Current: ${JSON.stringify(current)}`,
								),
							);
						}, 5000);

						const unsub = registry.subscribe(reposAtom, () => {
							const current = registry.get(reposAtom);
							console.log(
								"[test] subscription update:",
								JSON.stringify(current),
							);
							if (
								Result.isSuccess(current) &&
								Option.isSome(Result.value(current))
							) {
								clearTimeout(timeout);
								unsub();
								resolve(Option.getOrNull(Result.value(current)));
							}
							if (Result.isFailure(current)) {
								clearTimeout(timeout);
								unsub();
								reject(
									new Error(
										`Subscription failed: ${JSON.stringify(Option.getOrNull(Result.error(current)))}`,
									),
								);
							}
						});

						// Also check current value immediately (might already have data)
						const current = registry.get(reposAtom);
						if (
							Result.isSuccess(current) &&
							Option.isSome(Result.value(current))
						) {
							clearTimeout(timeout);
							resolve(Option.getOrNull(Result.value(current)));
						}
					}),
			);

			unmount();

			console.log("[test] final value:", JSON.stringify(finalValue));
			expect(finalValue).toBeInstanceOf(Array);
			expect((finalValue as Array<{ fullName: string }>).length).toBe(1);
			expect((finalValue as Array<{ fullName: string }>)[0].fullName).toBe(
				"testowner/testrepo",
			);
		}),
	);
});
