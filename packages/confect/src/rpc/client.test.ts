import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { Atom } from "@effect-atom/atom";
import { createRpcClient, RpcDefectError } from "./client";
import { createRpcFactory, makeRpcModule } from "./server";
import { defineTable, defineSchema } from "../schema";

const testSchema = defineSchema({
	guestbook: defineTable(
		Schema.Struct({
			author: Schema.String,
			message: Schema.String,
		}),
	),
});

const factory = createRpcFactory({ schema: testSchema });

const guestbookModule = makeRpcModule({
	add: factory.mutation(
		{
			payload: { author: Schema.String, message: Schema.String },
			success: Schema.String,
		},
		(payload) =>
			Effect.gen(function* () {
				return `Added message from ${payload.author}`;
			}),
	),
	list: factory.query(
		{
			success: Schema.Array(Schema.Struct({ author: Schema.String, message: Schema.String })),
		},
		() =>
			Effect.gen(function* () {
				return [{ author: "Alice", message: "Hello" }];
			}),
	),
	get: factory.query(
		{
			payload: { id: Schema.String },
			success: Schema.Struct({ author: Schema.String, message: Schema.String }),
			error: Schema.Struct({ _tag: Schema.Literal("NotFound") }),
		},
		(payload) =>
			Effect.gen(function* () {
				if (payload.id === "not-found") {
					return yield* Effect.fail({ _tag: "NotFound" as const });
				}
				return { author: "Bob", message: "Test" };
			}),
	),
	sendNotification: factory.action(
		{
			payload: { userId: Schema.String },
			success: Schema.Struct({ sent: Schema.Boolean }),
		},
		(_payload) =>
			Effect.gen(function* () {
				return { sent: true };
			}),
	),
});

describe("RPC Client", () => {
	describe("createRpcClient", () => {
		it("creates client with runtime property", () => {
			const mockApi = {
				add: guestbookModule.handlers.add,
				list: guestbookModule.handlers.list,
				get: guestbookModule.handlers.get,
				sendNotification: guestbookModule.handlers.sendNotification,
			};

			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			expect(client.runtime).toBeDefined();
			expect(typeof client.runtime.atom).toBe("function");
			expect(typeof client.runtime.fn).toBe("function");
			expect(typeof client.runtime.pull).toBe("function");
		});

		it("creates typed endpoint proxies for each module endpoint", () => {
			const mockApi = {
				add: guestbookModule.handlers.add,
				list: guestbookModule.handlers.list,
				get: guestbookModule.handlers.get,
				sendNotification: guestbookModule.handlers.sendNotification,
			};

			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			expect(client.add).toBeDefined();
			expect(client.list).toBeDefined();
			expect(client.get).toBeDefined();
			expect(client.sendNotification).toBeDefined();
		});

		it("mutation endpoints expose mutate AtomResultFn", () => {
			const mockApi = { add: guestbookModule.handlers.add };
			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			expect(client.add.mutate).toBeDefined();
			expect(typeof client.add.mutate).toBe("object");
		});

		it("query endpoints expose query and subscription functions", () => {
			const mockApi = { list: guestbookModule.handlers.list };
			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			expect(typeof client.list.query).toBe("function");
			expect(typeof client.list.queryEffect).toBe("function");
			expect(typeof client.list.queryPromise).toBe("function");
			expect(typeof client.list.subscription).toBe("function");
		});

		it("action endpoints expose call AtomResultFn", () => {
			const mockApi = { sendNotification: guestbookModule.handlers.sendNotification };
			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			expect(client.sendNotification.call).toBeDefined();
			expect(typeof client.sendNotification.call).toBe("object");
			expect(typeof client.sendNotification.callEffect).toBe("function");
			expect(typeof client.sendNotification.callPromise).toBe("function");
		});

		it("mutation endpoints expose imperative mutateEffect and mutatePromise", () => {
			const mockApi = { add: guestbookModule.handlers.add };
			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			expect(typeof client.add.mutateEffect).toBe("function");
			expect(typeof client.add.mutatePromise).toBe("function");
		});

		it("caches endpoint proxies (same reference on repeated access)", () => {
			const mockApi = { add: guestbookModule.handlers.add };
			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			const first = client.add;
			const second = client.add;
			expect(first).toBe(second);
		});

		it("query function returns atom for given payload", () => {
			const mockApi = { get: guestbookModule.handlers.get };
			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			const atom = client.get.query({ id: "123" });
			expect(atom).toBeDefined();
			expect(Atom.isAtom(atom)).toBe(true);
		});

		it("subscription function returns atom for given payload", () => {
			const mockApi = { list: guestbookModule.handlers.list };
			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			const atom = client.list.subscription({});
			expect(atom).toBeDefined();
			expect(Atom.isAtom(atom)).toBe(true);
		});
	});

	describe("RpcDefectError", () => {
		it("has correct _tag", () => {
			const error = new RpcDefectError({ defect: "test" });
			expect(error._tag).toBe("RpcDefectError");
		});

		it("stores string defect", () => {
			const error = new RpcDefectError({ defect: "Unexpected server crash" });
			expect(error.defect).toBe("Unexpected server crash");
		});

		it("stores complex object defect", () => {
			const complexDefect = {
				code: "INTERNAL_ERROR",
				message: "Database connection failed",
				stack: "Error at line 42...",
				metadata: { requestId: "abc123" },
			};
			const error = new RpcDefectError({ defect: complexDefect });
			expect(error.defect).toEqual(complexDefect);
		});

		it("is instanceof Error", () => {
			const error = new RpcDefectError({ defect: "test" });
			expect(error).toBeInstanceOf(Error);
		});
	});

	describe("type safety (compile-time checks)", () => {
		it("client.add.mutate is typed as AtomResultFn", () => {
			const mockApi = { add: guestbookModule.handlers.add };
			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			expect(client.add.mutate).toBeDefined();
			expect(Atom.isAtom(client.add.mutate)).toBe(true);
		});

		it("client.get.query payload is typed from module definition", () => {
			const mockApi = { get: guestbookModule.handlers.get };
			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			const atom = client.get.query({ id: "123" });
			expect(atom).toBeDefined();
		});

		it("client.sendNotification.call is typed as AtomResultFn", () => {
			const mockApi = { sendNotification: guestbookModule.handlers.sendNotification };
			const client = createRpcClient<typeof guestbookModule>(
				mockApi as never,
				{ url: "https://test.convex.cloud" },
			);

			expect(client.sendNotification.call).toBeDefined();
			expect(Atom.isAtom(client.sendNotification.call)).toBe(true);
		});
	});
});



describe("RPC Module", () => {
	describe("makeRpcModule", () => {
		it("creates module with handlers object", () => {
			expect(guestbookModule.handlers).toBeDefined();
			expect(guestbookModule.handlers.add).toBeDefined();
			expect(guestbookModule.handlers.list).toBeDefined();
			expect(guestbookModule.handlers.get).toBeDefined();
			expect(guestbookModule.handlers.sendNotification).toBeDefined();
		});

		it("creates module with rpcs object", () => {
			expect(guestbookModule.rpcs).toBeDefined();
			expect(guestbookModule.rpcs.add).toBeDefined();
			expect(guestbookModule.rpcs.list).toBeDefined();
			expect(guestbookModule.rpcs.get).toBeDefined();
			expect(guestbookModule.rpcs.sendNotification).toBeDefined();
		});

		it("creates module with group for @effect/rpc compatibility", () => {
			expect(guestbookModule.group).toBeDefined();
		});

		it("endpoint objects are accessible directly on module", () => {
			expect(guestbookModule.add).toBeDefined();
			expect(guestbookModule.add._tag).toBe("add");
			expect(guestbookModule.list._tag).toBe("list");
			expect(guestbookModule.get._tag).toBe("get");
			expect(guestbookModule.sendNotification._tag).toBe("sendNotification");
		});

		it("handlers are Convex registered functions", () => {
			expect(typeof guestbookModule.handlers.add).toBe("function");
			expect(typeof guestbookModule.handlers.list).toBe("function");
		});
	});

	describe("createRpcFactory", () => {
		it("creates factory with query, mutation, action methods", () => {
			expect(typeof factory.query).toBe("function");
			expect(typeof factory.mutation).toBe("function");
			expect(typeof factory.action).toBe("function");
		});

		it("creates factory with internal variants", () => {
			expect(typeof factory.internalQuery).toBe("function");
			expect(typeof factory.internalMutation).toBe("function");
			expect(typeof factory.internalAction).toBe("function");
		});
	});
});
