import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { OTEL_CONSOLE_MARKER, parseSerializedSpanLine } from "./json-exporter";

describe("parseSerializedSpanLine", () => {
	it("parses valid serialized span logs", () => {
		const line =
			OTEL_CONSOLE_MARKER +
			JSON.stringify({
				traceId: "0123456789abcdef0123456789abcdef",
				spanId: "0123456789abcdef",
				parentSpanId: null,
				name: "rpc.server.query.list",
				kind: 1,
				startTimeUnixNano: "1",
				endTimeUnixNano: "2",
				attributes: { "rpc.method": "list" },
				status: { code: 1 },
				resource: { "service.name": "database-tests" },
				scope: { name: "test-scope" },
			});

		const parsed = parseSerializedSpanLine(line);
		expect(Option.isSome(parsed)).toBe(true);

		if (Option.isSome(parsed)) {
			expect(parsed.value.name).toBe("rpc.server.query.list");
			expect(parsed.value.traceId).toBe("0123456789abcdef0123456789abcdef");
		}
	});

	it("returns none for non-span lines", () => {
		const parsed = parseSerializedSpanLine("normal console log");
		expect(Option.isNone(parsed)).toBe(true);
	});
});
