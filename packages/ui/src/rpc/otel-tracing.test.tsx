import { Result, useAtom } from "@effect-atom/atom-react";
import { api } from "@packages/database/convex/_generated/api";
import type { GuestbookModule } from "@packages/database/convex/rpc/guestbook";
import { createOtelConsoleTestLayer } from "@packages/observability/effect-otel-test";
import {
	parseSerializedSpanLine,
	type SerializedSpan,
} from "@packages/observability/json-exporter";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Array as Arr, Option } from "effect";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { rpcClientContext } from "./guestbook";
import { createRpcModuleTestContext } from "./test-context";

const createTracingTestContext = () =>
	createRpcModuleTestContext<GuestbookModule>({
		moduleApi: api.rpc.guestbook,
		layer: createOtelConsoleTestLayer("main-site"),
		wrapChildren: (children, client) =>
			createElement(rpcClientContext.RpcClientProvider, { client }, children),
	});

const getServiceName = (span: SerializedSpan): string => {
	const value = span.resource["service.name"];
	return typeof value === "string" ? value : "";
};

const isRpcMethod = (span: SerializedSpan, method: string): boolean => {
	const value = span.attributes["rpc.method"];
	return typeof value === "string" && value === method;
};

describe("RPC telemetry tracing", () => {
	it("links frontend and convex spans with a shared trace", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			const { client, wrapper } = createTracingTestContext();

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
					message: "Trace me",
					name: "Telemetry",
				});
			});

			await waitFor(() => {
				expect(Result.isSuccess(result.current.addResult)).toBe(true);
			});

			const loggedLines = Arr.flatMap(consoleSpy.mock.calls, (args) =>
				Arr.map(args, (value) => String(value)),
			);
			const spans = Arr.filterMap(loggedLines, parseSerializedSpanLine);

			const frontendSpan = Arr.findFirst(
				spans,
				(span) =>
					getServiceName(span) === "main-site" &&
					span.name === "rpc.client.mutation.add" &&
					isRpcMethod(span, "add"),
			);

			const backendSpan = Arr.findFirst(
				spans,
				(span) =>
					getServiceName(span) === "database-tests" &&
					span.name === "rpc.server.mutation.add" &&
					isRpcMethod(span, "add"),
			);

			expect(Option.isSome(frontendSpan)).toBe(true);
			expect(Option.isSome(backendSpan)).toBe(true);

			if (Option.isSome(frontendSpan) && Option.isSome(backendSpan)) {
				expect(backendSpan.value.traceId).toBe(frontendSpan.value.traceId);
				expect(backendSpan.value.parentSpanId).toBe(frontendSpan.value.spanId);
			}
		} finally {
			consoleSpy.mockRestore();
		}
	});
});
