import { RegistryProvider } from "@effect-atom/atom-react";
import {
	type AnyRpcModule,
	createRpcClient,
	type RpcModuleClient,
} from "@packages/confect/rpc";
import { createConvexTestLayer } from "@packages/database/testing";
import { Layer } from "effect";
import { createElement, type ReactNode } from "react";

const TEST_CONVEX_URL = "https://test.convex.cloud";
const DEFAULT_ENABLE_PAYLOAD_TELEMETRY_FALLBACK =
	process.env.NEXT_PUBLIC_CONVEX_OTEL_PAYLOAD_FALLBACK !== "false";

type ModuleApi<TModule extends AnyRpcModule> = Parameters<
	typeof createRpcClient<TModule>
>[0];

type WrapChildren<TModule extends AnyRpcModule> = (
	children: ReactNode,
	client: RpcModuleClient<TModule>,
) => ReactNode;

export const createRpcModuleTestContext = <
	TModule extends AnyRpcModule,
>(options: {
	readonly moduleApi: ModuleApi<TModule>;
	readonly wrapChildren?: WrapChildren<TModule>;
	readonly layer?: Layer.Layer<never>;
	readonly enablePayloadTelemetryFallback?: boolean;
}) => {
	const layer =
		options.layer === undefined
			? createConvexTestLayer()
			: Layer.mergeAll(createConvexTestLayer(), options.layer);
	const client = createRpcClient<TModule>(options.moduleApi, {
		layer,
		url: TEST_CONVEX_URL,
		enablePayloadTelemetryFallback:
			options.enablePayloadTelemetryFallback ??
			DEFAULT_ENABLE_PAYLOAD_TELEMETRY_FALLBACK,
	});

	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(
			RegistryProvider,
			null,
			options.wrapChildren ? options.wrapChildren(children, client) : children,
		);

	return {
		client,
		wrapper,
	};
};
