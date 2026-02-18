import { createInterface } from "node:readline";
import { parseSerializedSpanLine } from "@packages/observability/json-exporter";

const spansByTraceId = new Map<string, Array<string>>();

const onLine = (line: string) => {
	const spanOption = parseSerializedSpanLine(line);
	if (spanOption._tag === "None") {
		return;
	}

	const span = spanOption.value;
	const current = spansByTraceId.get(span.traceId) ?? [];
	current.push(`${span.name} (${span.spanId})`);
	spansByTraceId.set(span.traceId, current);
};

const printSummary = () => {
	const traceEntries = Array.from(spansByTraceId.entries());

	if (traceEntries.length === 0) {
		console.log("No OTEL spans were processed.");
		return;
	}

	console.log(`Processed ${traceEntries.length} trace(s).`);

	for (const [traceId, spanNames] of traceEntries) {
		console.log(`Trace ${traceId}:`);
		for (const spanName of spanNames) {
			console.log(`  - ${spanName}`);
		}
	}
};

const input = createInterface({
	input: process.stdin,
	crlfDelay: Infinity,
});

input.on("line", onLine);
input.on("close", printSummary);
