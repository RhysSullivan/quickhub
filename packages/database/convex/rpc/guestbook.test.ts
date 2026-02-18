import { layer } from "@effect/vitest";
import { ConvexClient } from "@packages/confect/client";
import type { ExitEncoded } from "@packages/confect/rpc";
import { makeTestLayer } from "@packages/confect/testing";
import { convexTest } from "@packages/convex-test";
import {
	parseSerializedSpanLine,
	type SerializedSpan,
} from "@packages/observability/json-exporter";
import { Array as Arr, Effect } from "effect";
import { expect, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");

const TestLayer = makeTestLayer({ schema, modules, convexTest });

const getServiceName = (span: SerializedSpan): string => {
	const value = span.resource["service.name"];
	return typeof value === "string" ? value : "";
};

layer(TestLayer)("guestbook RPC module", (it) => {
	it.effect("should add and list entries", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			const addResult = (yield* client.mutation(api.rpc.guestbook.add, {
				name: "Alice",
				message: "Hello world!",
			})) as ExitEncoded;

			expect(addResult._tag).toBe("Success");

			const listResult = (yield* client.query(
				api.rpc.guestbook.list,
				{},
			)) as ExitEncoded;

			expect(listResult._tag).toBe("Success");
			if (listResult._tag === "Success") {
				const entries = listResult.value as Array<{
					name: string;
					message: string;
				}>;
				expect(entries).toHaveLength(1);
				expect(entries[0]).toMatchObject({
					name: "Alice",
					message: "Hello world!",
				});
			}
		}),
	);

	it.effect("should return error for empty name", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			const result = (yield* client.mutation(api.rpc.guestbook.add, {
				name: "   ",
				message: "Hello world!",
			})) as ExitEncoded;

			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				const cause = result.cause as {
					_tag: string;
					error?: { _tag: string; field: string };
				};
				expect(cause._tag).toBe("Fail");
				expect(cause.error?._tag).toBe("EmptyFieldError");
				expect(cause.error?.field).toBe("name");
			}
		}),
	);

	it.effect("should return error for empty message", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			const result = (yield* client.mutation(api.rpc.guestbook.add, {
				name: "Alice",
				message: "",
			})) as ExitEncoded;

			expect(result._tag).toBe("Failure");
		}),
	);

	it.effect("should allow adding multiple entries", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			yield* client.mutation(api.rpc.guestbook.add, {
				name: "Bob",
				message: "Second entry",
			});

			const result = (yield* client.query(
				api.rpc.guestbook.list,
				{},
			)) as ExitEncoded;

			expect(result._tag).toBe("Success");
			if (result._tag === "Success") {
				const entries = result.value as Array<{
					name: string;
					message: string;
				}>;
				expect(entries.length).toBeGreaterThanOrEqual(1);
				expect(entries.some((e) => e.name === "Bob")).toBe(true);
			}
		}),
	);

	it.effect("should paginate entries", () =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;

			for (let i = 1; i <= 5; i++) {
				yield* client.mutation(api.rpc.guestbook.add, {
					name: `User${i}`,
					message: `Message ${i}`,
				});
			}

			const page1Result = (yield* client.query(
				api.rpc.guestbook.listPaginated,
				{
					cursor: null,
					numItems: 2,
				},
			)) as ExitEncoded;

			expect(page1Result._tag).toBe("Success");
			if (page1Result._tag === "Success") {
				const page1 = page1Result.value as {
					page: Array<{ name: string; message: string }>;
					isDone: boolean;
					continueCursor: string;
				};
				expect(page1.page).toHaveLength(2);
				expect(page1.isDone).toBe(false);
				expect(page1.continueCursor).toBeDefined();

				const page2Result = (yield* client.query(
					api.rpc.guestbook.listPaginated,
					{
						cursor: page1.continueCursor,
						numItems: 2,
					},
				)) as ExitEncoded;

				expect(page2Result._tag).toBe("Success");
				if (page2Result._tag === "Success") {
					const page2 = page2Result.value as {
						page: Array<{ name: string; message: string }>;
						isDone: boolean;
						continueCursor: string;
					};
					expect(page2.page).toHaveLength(2);
				}
			}
		}),
	);

	it.effect.skip("emits backend spans for rpc handlers", () =>
		Effect.gen(function* () {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			try {
				const client = yield* ConvexClient;

				yield* client.mutation(api.rpc.guestbook.add, {
					name: "Trace",
					message: "Capture backend span",
				});

				let spanSeen = false;

				for (let attempt = 0; attempt < 100; attempt += 1) {
					const logLines = Arr.flatMap(logSpy.mock.calls, (args) =>
						Arr.map(args, (value) => String(value)),
					);
					const spans = Arr.filterMap(logLines, parseSerializedSpanLine);

					spanSeen = spans.some(
						(span) =>
							getServiceName(span) === "database-tests" &&
							span.name === "rpc.server.mutation.add",
					);

					if (spanSeen) {
						break;
					}

					yield* Effect.yieldNow();
				}

				expect(spanSeen).toBe(true);
			} finally {
				logSpy.mockRestore();
			}
		}),
	);
});
