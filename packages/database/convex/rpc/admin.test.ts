import { expect } from "vitest";
import { layer } from "@effect/vitest";
import { convexTest } from "@packages/convex-test";
import { Effect } from "effect";
import { makeTestLayer } from "@packages/confect/testing";
import { ConvexClient } from "@packages/confect/client";
import schema from "../schema";
import { api } from "../_generated/api";
import type { ExitEncoded } from "@packages/confect/rpc";

const modules = import.meta.glob("/convex/**/*.ts");

const TestLayer = makeTestLayer({ schema, modules, convexTest });

layer(TestLayer)("admin RPC module", (it) => {
	it.effect("getStats returns stats with valid key", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			yield* client.mutation(api.rpc.guestbook.add, {
				name: "Test",
				message: "Hello",
			});
			yield* client.mutation(api.rpc.guestbook.add, {
				name: "Test2",
				message: "World",
			});

			const result = (yield* client.query(api.rpc.admin.getStats, {
				privateAccessKey: "dev-secret-key",
			})) as ExitEncoded;

			expect(result._tag).toBe("Success");
			if (result._tag === "Success") {
				expect(result.value).toEqual({ guestbookCount: 2 });
			}
		}),
	);

	it.effect("getStats fails with invalid key", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			const result = (yield* client.query(api.rpc.admin.getStats, {
				privateAccessKey: "wrong-key",
			})) as ExitEncoded;

			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				const cause = result.cause as {
					_tag: string;
					error?: { _tag: string; message: string };
				};
				expect(cause._tag).toBe("Fail");
				expect(cause.error?._tag).toBe("UnauthorizedError");
				expect(cause.error?.message).toBe("Invalid private access key");
			}
		}),
	);

	it.effect("clearGuestbook clears all entries with valid key", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			const initialStats = (yield* client.query(api.rpc.admin.getStats, {
				privateAccessKey: "dev-secret-key",
			})) as ExitEncoded;
			const initialCount =
				initialStats._tag === "Success"
					? (initialStats.value as { guestbookCount: number }).guestbookCount
					: 0;

			yield* client.mutation(api.rpc.guestbook.add, {
				name: "Test1",
				message: "Hello",
			});
			yield* client.mutation(api.rpc.guestbook.add, {
				name: "Test2",
				message: "World",
			});
			yield* client.mutation(api.rpc.guestbook.add, {
				name: "Test3",
				message: "!",
			});

			const result = (yield* client.mutation(api.rpc.admin.clearGuestbook, {
				privateAccessKey: "dev-secret-key",
			})) as ExitEncoded;

			expect(result._tag).toBe("Success");
			if (result._tag === "Success") {
				expect(result.value).toBe(initialCount + 3);
			}

			const statsResult = (yield* client.query(api.rpc.admin.getStats, {
				privateAccessKey: "dev-secret-key",
			})) as ExitEncoded;

			expect(statsResult._tag).toBe("Success");
			if (statsResult._tag === "Success") {
				const stats = statsResult.value as { guestbookCount: number };
				expect(stats.guestbookCount).toBe(0);
			}
		}),
	);

	it.effect("clearGuestbook fails with invalid key", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			yield* client.mutation(api.rpc.guestbook.add, {
				name: "Test",
				message: "Hello",
			});

			const result = (yield* client.mutation(api.rpc.admin.clearGuestbook, {
				privateAccessKey: "wrong-key",
			})) as ExitEncoded;

			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				const cause = result.cause as {
					_tag: string;
					error?: { _tag: string; message: string };
				};
				expect(cause._tag).toBe("Fail");
				expect(cause.error?._tag).toBe("UnauthorizedError");
			}

			const statsResult = (yield* client.query(api.rpc.admin.getStats, {
				privateAccessKey: "dev-secret-key",
			})) as ExitEncoded;

			expect(statsResult._tag).toBe("Success");
			if (statsResult._tag === "Success") {
				const stats = statsResult.value as { guestbookCount: number };
				expect(stats.guestbookCount).toBe(1);
			}
		}),
	);
});
