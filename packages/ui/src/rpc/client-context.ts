"use client";

import { type AnyRpcModule, createRpcClient } from "@packages/confect/rpc";
import { sharedConvexClientLayer } from "@packages/ui/components/convex-client-provider";
import {
	createContext,
	createElement,
	type ReactNode,
	useContext,
} from "react";

type ClientProviderProps<TClient> = {
	readonly client: TClient;
	readonly children?: ReactNode;
};

type ClientContextApi<TClient> = {
	readonly RpcClientProvider: (
		props: ClientProviderProps<TClient>,
	) => ReactNode;
	readonly useRpcClient: () => TClient;
};

type ModuleApi<TModule extends AnyRpcModule> = Parameters<
	typeof createRpcClient<TModule>
>[0];

const DEFAULT_CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const ENABLE_PAYLOAD_TELEMETRY_FALLBACK =
	process.env.NEXT_PUBLIC_CONVEX_OTEL_PAYLOAD_FALLBACK !== "false";

export const createRpcClientContext = <TClient>(
	createDefaultClient: () => TClient,
): ClientContextApi<TClient> => {
	const ClientContext = createContext<TClient | null>(null);
	let defaultClient: TClient | null = null;

	const getDefaultClient = () => {
		if (defaultClient === null) {
			defaultClient = createDefaultClient();
		}

		return defaultClient;
	};

	const RpcClientProvider = ({
		client,
		children,
	}: ClientProviderProps<TClient>) =>
		createElement(ClientContext.Provider, { value: client }, children);

	const useRpcClient = () => {
		const client = useContext(ClientContext);
		return client ?? getDefaultClient();
	};

	return {
		RpcClientProvider,
		useRpcClient,
	};
};

export const createRpcModuleClientContext = <TModule extends AnyRpcModule>(
	moduleApi: ModuleApi<TModule>,
	options: {
		readonly url?: string;
	} = {},
) =>
	createRpcClientContext(() =>
		createRpcClient<TModule>(moduleApi, {
			url: options.url ?? DEFAULT_CONVEX_URL,
			layer: sharedConvexClientLayer,
			enablePayloadTelemetryFallback: ENABLE_PAYLOAD_TELEMETRY_FALLBACK,
		}),
	);
