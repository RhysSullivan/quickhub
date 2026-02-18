import { Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { api } from "@packages/database/convex/_generated/api";
import type { GuestbookModule } from "@packages/database/convex/rpc/guestbook";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Option } from "effect";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { usePaginatedAtom } from "../hooks/use-paginated-atom";
import { rpcClientContext } from "./guestbook";
import { createRpcModuleTestContext } from "./test-context";

const createTestContext = () =>
	createRpcModuleTestContext<GuestbookModule>({
		moduleApi: api.rpc.guestbook,
		wrapChildren: (children, client) =>
			createElement(rpcClientContext.RpcClientProvider, { client }, children),
	});

describe("guestbook rpc hooks", () => {
	it("supports mutation and subscription updates via hooks", async () => {
		const { client, wrapper } = createTestContext();
		const listAtom = client.list.subscription({});

		const { result } = renderHook(
			() => {
				const listResult = useAtomValue(listAtom);
				const [addResult, addEntry] = useAtom(client.add.mutate);

				return {
					addEntry,
					addResult,
					listResult,
				};
			},
			{ wrapper },
		);

		await waitFor(() => {
			const entries = Result.value(result.current.listResult);
			expect(Option.isSome(entries)).toBe(true);
			if (Option.isSome(entries)) {
				expect(entries.value).toHaveLength(0);
			}
		});

		act(() => {
			result.current.addEntry({
				message: "Hello from frontend test",
				name: "Alice",
			});
		});

		await waitFor(() => {
			expect(Result.isSuccess(result.current.addResult)).toBe(true);
		});

		await waitFor(() => {
			const entries = Result.value(result.current.listResult);
			expect(Option.isSome(entries)).toBe(true);
			if (Option.isSome(entries)) {
				expect(entries.value).toHaveLength(1);
				expect(entries.value[0]).toMatchObject({
					message: "Hello from frontend test",
					name: "Alice",
				});
			}
		});
	});

	it("returns typed validation errors for mutation hooks", async () => {
		const { client, wrapper } = createTestContext();

		const { result } = renderHook(
			() => {
				const [addResult, addEntry] = useAtom(client.add.mutate);

				return {
					addEntry,
					addResult,
				};
			},
			{ wrapper },
		);

		act(() => {
			result.current.addEntry({
				message: "Hello",
				name: "   ",
			});
		});

		await waitFor(() => {
			expect(Result.isFailure(result.current.addResult)).toBe(true);
		});

		const addError = Result.error(result.current.addResult);
		expect(Option.isSome(addError)).toBe(true);
		if (Option.isSome(addError)) {
			expect(addError.value._tag).toBe("EmptyFieldError");
			if (addError.value._tag === "EmptyFieldError") {
				expect(addError.value.field).toBe("name");
			}
		}
	});

	it("loads cursor pages with usePaginatedAtom", async () => {
		const { client, wrapper } = createTestContext();

		for (let i = 1; i <= 5; i++) {
			await client.add.mutatePromise({
				message: `Message ${i}`,
				name: `User${i}`,
			});
		}

		const paginatedAtom = client.listPaginated.paginated(2);
		const { result } = renderHook(() => usePaginatedAtom(paginatedAtom), {
			wrapper,
		});

		expect(result.current.isInitial).toBe(true);

		act(() => {
			result.current.loadMore();
		});

		await waitFor(() => {
			expect(result.current.items.length).toBeGreaterThan(0);
			expect(result.current.hasMore).toBe(true);
		});

		const firstLoadCount = result.current.items.length;

		act(() => {
			result.current.loadMore();
		});

		await waitFor(() => {
			expect(result.current.items.length).toBeGreaterThan(firstLoadCount);
		});

		for (let i = 0; i < 5; i++) {
			if (!result.current.hasMore) {
				break;
			}

			act(() => {
				result.current.loadMore();
			});

			await waitFor(() => {
				expect(result.current.isLoading).toBe(false);
			});
		}

		expect(result.current.items).toHaveLength(5);
		expect(result.current.done).toBe(true);
		expect(result.current.hasMore).toBe(false);
	});
});
