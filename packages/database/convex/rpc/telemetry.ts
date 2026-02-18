import { createConvexOtelLayer } from "@packages/observability/convex-effect-otel";
import { Layer } from "effect";

const telemetryEnabled = process.env.CONVEX_OTEL_ENABLED === "true";

const serviceName =
	process.env.NODE_ENV === "test" ? "database-tests" : "database";

export const DatabaseRpcTelemetryLayer = telemetryEnabled
	? createConvexOtelLayer(serviceName)
	: Layer.empty;
