import * as OtlpTracer from "@effect/opentelemetry/OtlpTracer";
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as Duration from "effect/Duration";
import type * as LayerType from "effect/Layer";
import * as Layer from "effect/Layer";

export type ServiceName =
	| "discord-bot"
	| "main-site"
	| "dashboard"
	| "database"
	| "database-tests"
	| "test-service";

export const createOtelLayer = (
	serviceName: ServiceName,
	otlpEndpoint = "http://localhost:4318/v1/traces",
	exportInterval: Duration.DurationInput = Duration.seconds(5),
	shutdownTimeout: Duration.DurationInput = Duration.seconds(5),
): LayerType.Layer<never> =>
	OtlpTracer.layer({
		url: otlpEndpoint,
		resource: { serviceName },
		exportInterval,
		shutdownTimeout,
		maxBatchSize: 1000,
	}).pipe(Layer.provide(FetchHttpClient.layer));
