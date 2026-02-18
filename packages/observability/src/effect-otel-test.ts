import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import type * as Resource from "@effect/opentelemetry/Resource";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import * as Duration from "effect/Duration";
import type * as LayerType from "effect/Layer";
import type { ServiceName } from "./effect-otel";
import { JsonConsoleSpanExporter } from "./json-exporter";

export const createOtelTestLayer = (
	serviceName: ServiceName,
	otlpEndpoint = "http://localhost:4318/v1/traces",
	shutdownTimeout: Duration.DurationInput = Duration.seconds(5),
): LayerType.Layer<Resource.Resource> =>
	NodeSdk.layer(() => ({
		resource: { serviceName },
		spanProcessor: new SimpleSpanProcessor(
			new OTLPTraceExporter({
				url: otlpEndpoint,
			}),
		),
		shutdownTimeout,
	}));

export const createOtelConsoleTestLayer = (
	serviceName: ServiceName,
	shutdownTimeout: Duration.DurationInput = Duration.seconds(5),
): LayerType.Layer<Resource.Resource> =>
	NodeSdk.layer(() => ({
		resource: { serviceName },
		spanProcessor: new SimpleSpanProcessor(new JsonConsoleSpanExporter()),
		shutdownTimeout,
	}));
