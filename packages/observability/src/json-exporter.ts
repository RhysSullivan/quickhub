import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import * as Option from "effect/Option";

export const OTEL_CONSOLE_MARKER = "__OTEL_SPAN__";

export type SerializedSpan = {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes: Record<string, unknown>;
	status: { code: number; message?: string };
	resource: Record<string, unknown>;
	scope: { name: string; version?: string };
};

const toStringRecord = (value: object): Record<string, unknown> =>
	Object.fromEntries(Object.entries(value));

const parseStatus = (
	value: unknown,
): Option.Option<{ code: number; message?: string }> => {
	if (typeof value !== "object" || value === null) {
		return Option.none();
	}

	const code = Reflect.get(value, "code");
	if (typeof code !== "number") {
		return Option.none();
	}

	const message = Reflect.get(value, "message");
	if (typeof message === "string") {
		return Option.some({ code, message });
	}

	return Option.some({ code });
};

const parseScope = (
	value: unknown,
): Option.Option<{ name: string; version?: string }> => {
	if (typeof value !== "object" || value === null) {
		return Option.none();
	}

	const name = Reflect.get(value, "name");
	if (typeof name !== "string") {
		return Option.none();
	}

	const version = Reflect.get(value, "version");
	if (typeof version === "string") {
		return Option.some({ name, version });
	}

	return Option.some({ name });
};

export const parseSerializedSpanLine = (
	line: string,
): Option.Option<SerializedSpan> => {
	if (!line.startsWith(OTEL_CONSOLE_MARKER)) {
		return Option.none();
	}

	const payload = line.slice(OTEL_CONSOLE_MARKER.length);
	let parsed: unknown;

	try {
		parsed = JSON.parse(payload);
	} catch {
		return Option.none();
	}

	if (typeof parsed !== "object" || parsed === null) {
		return Option.none();
	}

	const traceId = Reflect.get(parsed, "traceId");
	const spanId = Reflect.get(parsed, "spanId");
	const parentSpanId = Reflect.get(parsed, "parentSpanId");
	const name = Reflect.get(parsed, "name");
	const kind = Reflect.get(parsed, "kind");
	const startTimeUnixNano = Reflect.get(parsed, "startTimeUnixNano");
	const endTimeUnixNano = Reflect.get(parsed, "endTimeUnixNano");
	const attributes = Reflect.get(parsed, "attributes");
	const status = Reflect.get(parsed, "status");
	const resource = Reflect.get(parsed, "resource");
	const scope = Reflect.get(parsed, "scope");

	if (
		typeof traceId !== "string" ||
		typeof spanId !== "string" ||
		!(typeof parentSpanId === "string" || parentSpanId === null) ||
		typeof name !== "string" ||
		typeof kind !== "number" ||
		typeof startTimeUnixNano !== "string" ||
		typeof endTimeUnixNano !== "string" ||
		typeof attributes !== "object" ||
		attributes === null ||
		typeof resource !== "object" ||
		resource === null
	) {
		return Option.none();
	}

	const parsedStatus = parseStatus(status);
	if (Option.isNone(parsedStatus)) {
		return Option.none();
	}

	const parsedScope = parseScope(scope);
	if (Option.isNone(parsedScope)) {
		return Option.none();
	}

	return Option.some({
		traceId,
		spanId,
		parentSpanId,
		name,
		kind,
		startTimeUnixNano,
		endTimeUnixNano,
		attributes: toStringRecord(attributes),
		status: parsedStatus.value,
		resource: toStringRecord(resource),
		scope: parsedScope.value,
	});
};

function hrTimeToNanoseconds(time: [number, number]): bigint {
	return BigInt(time[0]) * 1_000_000_000n + BigInt(time[1]);
}

export class JsonConsoleSpanExporter implements SpanExporter {
	export(
		spans: ReadableSpan[],
		resultCallback: (result: ExportResult) => void,
	): void {
		try {
			for (const span of spans) {
				const ctx = span.spanContext();
				const start = hrTimeToNanoseconds(span.startTime);
				const end = hrTimeToNanoseconds(span.endTime);

				const payload: SerializedSpan = {
					traceId: ctx.traceId,
					spanId: ctx.spanId,
					parentSpanId: span.parentSpanContext?.spanId ?? null,
					name: span.name,
					kind: span.kind,
					startTimeUnixNano: start.toString(),
					endTimeUnixNano: end.toString(),
					attributes: toStringRecord(span.attributes),
					status: {
						code: span.status.code,
						...(span.status.message ? { message: span.status.message } : {}),
					},
					resource: toStringRecord(span.resource.attributes),
					scope: {
						name: span.instrumentationScope.name,
						version: span.instrumentationScope.version,
					},
				};

				console.log(OTEL_CONSOLE_MARKER + JSON.stringify(payload));
			}

			resultCallback({ code: ExportResultCode.SUCCESS });
		} catch (err) {
			console.error("JsonConsoleSpanExporter error", err);
			resultCallback({ code: ExportResultCode.FAILED });
		}
	}

	shutdown(): Promise<void> {
		return Promise.resolve();
	}
}
