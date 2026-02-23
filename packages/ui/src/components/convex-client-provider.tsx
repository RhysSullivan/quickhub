"use client";

import { Atom, RegistryProvider } from "@effect-atom/atom-react";
import {
	ConvexClient,
	type ConvexClientService,
	type ConvexRequestMetadata,
} from "@packages/confect/client";
import { createOtelLayer } from "@packages/observability/effect-otel";
import { authClient } from "@packages/ui/lib/auth-client";
import { ConvexClient as ConvexBrowserClient } from "convex/browser";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { Duration, Effect, Layer, Stream } from "effect";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;

/**
 * Single shared ConvexBrowserClient instance.
 * Every RPC module and the provider itself must use this same instance
 * so that auth tokens set via `setAuth` are visible everywhere.
 */
const convexBrowserClient = new ConvexBrowserClient(CONVEX_URL, {
	unsavedChangesWarning: false,
});

const convexClientService: ConvexClientService = {
	query: <Query extends FunctionReference<"query">>(
		query: Query,
		args: Query["_args"],
		_requestMetadata?: ConvexRequestMetadata,
	): Effect.Effect<FunctionReturnType<Query>> =>
		Effect.promise(() => convexBrowserClient.query(query, args)),

	mutation: <Mutation extends FunctionReference<"mutation">>(
		mutation: Mutation,
		args: Mutation["_args"],
		_requestMetadata?: ConvexRequestMetadata,
	): Effect.Effect<FunctionReturnType<Mutation>> =>
		Effect.promise(() => convexBrowserClient.mutation(mutation, args)),

	action: <Action extends FunctionReference<"action">>(
		action: Action,
		args: Action["_args"],
		_requestMetadata?: ConvexRequestMetadata,
	): Effect.Effect<FunctionReturnType<Action>> =>
		Effect.promise(() => convexBrowserClient.action(action, args)),

	subscribe: <Query extends FunctionReference<"query">>(
		query: Query,
		args: Query["_args"],
	): Stream.Stream<FunctionReturnType<Query>> =>
		Stream.async((emit) => {
			const unsubscribe = convexBrowserClient.onUpdate(
				query,
				args,
				(result) => {
					emit.single(result);
				},
			);
			return Effect.sync(() => unsubscribe());
		}),
};

const FrontendOtelLayer =
	process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT === undefined
		? Layer.empty
		: createOtelLayer(
				"main-site",
				process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT,
				Duration.seconds(1),
			);

/**
 * Shared ConvexClient layer — one instance used by the provider AND all RPC modules.
 */
export const sharedConvexClientLayer = Layer.succeed(
	ConvexClient,
	convexClientService,
);

const AppConvexClientLayer = Layer.mergeAll(
	FrontendOtelLayer,
	sharedConvexClientLayer,
);

export const atomRuntime = Atom.runtime(AppConvexClientLayer);

/**
 * Query gating state for Convex-backed atoms.
 *
 * `isReadyForQueries` only flips true after auth is fully resolved AND
 * the Convex client has been configured with the current auth mode.
 */
type ConvexAuthState = {
	readonly isAuthResolved: boolean;
	readonly isConvexAuthSynced: boolean;
	readonly isReadyForQueries: boolean;
};

const ConvexAuthStateContext = createContext<ConvexAuthState | null>(null);

export const useConvexAuthState = (): ConvexAuthState => {
	const value = useContext(ConvexAuthStateContext);
	if (value === null) {
		throw new Error(
			"useConvexAuthState must be used inside ConvexClientProvider",
		);
	}
	return value;
};

export function ConvexClientProvider({ children }: { children: ReactNode }) {
	const { data: session, isPending } = authClient.useSession();
	const sessionId = session?.session?.id;
	const [isConvexAuthSynced, setConvexAuthSynced] = useState(false);

	useEffect(() => {
		if (isPending) {
			setConvexAuthSynced(false);
			return;
		}

		setConvexAuthSynced(false);

		if (sessionId) {
			convexBrowserClient.setAuth(async () => {
				try {
					const { data } = await authClient.convex.token();
					return data?.token ?? null;
				} catch {
					return null;
				}
			});
		} else {
			convexBrowserClient.setAuth(async () => null);
		}

		setConvexAuthSynced(true);
	}, [isPending, sessionId]);

	const authState = useMemo<ConvexAuthState>(
		() => ({
			isAuthResolved: !isPending,
			isConvexAuthSynced,
			isReadyForQueries: !isPending && isConvexAuthSynced,
		}),
		[isPending, isConvexAuthSynced],
	);

	return (
		<RegistryProvider defaultIdleTTL={30_000}>
			<ConvexAuthStateContext.Provider value={authState}>
				{children}
			</ConvexAuthStateContext.Provider>
		</RegistryProvider>
	);
}
