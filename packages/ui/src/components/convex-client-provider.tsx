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
import { type ReactNode, useEffect, useRef } from "react";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;

/**
 * Single shared ConvexBrowserClient instance.
 * Every RPC module and the provider itself must use this same instance
 * so that auth tokens set via `setAuth` are visible everywhere.
 */
const convexBrowserClient = new ConvexBrowserClient(CONVEX_URL);

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
 * Syncs Better Auth session state to the shared Convex client.
 * When signed in, sets a token fetcher that gets JWTs from `/convex/token`.
 * When signed out, clears auth.
 */
function ConvexAuthSync() {
	const { data: session, isPending } = authClient.useSession();
	const sessionId = session?.session?.id;
	const prevSessionIdRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		if (isPending) return;

		if (sessionId && sessionId !== prevSessionIdRef.current) {
			convexBrowserClient.setAuth(async () => {
				try {
					const { data } = await authClient.convex.token();
					return data?.token ?? null;
				} catch {
					return null;
				}
			});
		} else if (!sessionId && prevSessionIdRef.current) {
			convexBrowserClient.setAuth(async () => null);
		}

		prevSessionIdRef.current = sessionId ?? undefined;
	}, [isPending, sessionId]);

	return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
	return (
		<RegistryProvider defaultIdleTTL={30_000}>
			<ConvexAuthSync />
			{children}
		</RegistryProvider>
	);
}
