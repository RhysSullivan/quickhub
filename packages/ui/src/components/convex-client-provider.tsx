"use client";

import { Atom, RegistryProvider } from "@effect-atom/atom-react";
import {
	ConvexClient,
	type ConvexClientService,
	type ConvexRequestMetadata,
} from "@packages/confect/client";
import { createOtelLayer } from "@packages/observability/effect-otel";
import { ConvexClient as ConvexBrowserClient } from "convex/browser";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { Duration, Effect, Layer, Stream } from "effect";
import type { ReactNode } from "react";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;

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

const AppConvexClientLayer = Layer.mergeAll(
	FrontendOtelLayer,
	Layer.succeed(ConvexClient, convexClientService),
);

export const atomRuntime = Atom.runtime(AppConvexClientLayer);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
	return (
		<RegistryProvider defaultIdleTTL={30_000}>{children}</RegistryProvider>
	);
}
