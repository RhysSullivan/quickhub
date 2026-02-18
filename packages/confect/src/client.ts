import type { FunctionReference, FunctionReturnType } from "convex/server";
import {
	ConvexClient as ConvexClientImpl,
	ConvexHttpClient,
} from "convex/browser";
import { Context, Effect, Layer, Stream } from "effect";

export interface ConvexRequestMetadata {
	readonly headers?: Readonly<Record<string, string>>;
}

export interface ConvexClientService {
	query<Query extends FunctionReference<"query">>(
		query: Query,
		args: Query["_args"],
		requestMetadata?: ConvexRequestMetadata,
	): Effect.Effect<FunctionReturnType<Query>>;

	mutation<Mutation extends FunctionReference<"mutation">>(
		mutation: Mutation,
		args: Mutation["_args"],
		requestMetadata?: ConvexRequestMetadata,
	): Effect.Effect<FunctionReturnType<Mutation>>;

	action<Action extends FunctionReference<"action">>(
		action: Action,
		args: Action["_args"],
		requestMetadata?: ConvexRequestMetadata,
	): Effect.Effect<FunctionReturnType<Action>>;

	subscribe<Query extends FunctionReference<"query">>(
		query: Query,
		args: Query["_args"],
	): Stream.Stream<FunctionReturnType<Query>>;
}

export class ConvexClient extends Context.Tag("@confect/ConvexClient")<
	ConvexClient,
	ConvexClientService
>() {}

export const ConvexClientLayer = (
	url: string,
): Layer.Layer<ConvexClient> => {
	const wsClient = new ConvexClientImpl(url);

	const callHttpWithMetadata = <A>(
		requestMetadata: ConvexRequestMetadata | undefined,
		run: (httpClient: ConvexHttpClient) => Promise<A>,
	): Promise<A> => {
		const baseFetch = globalThis.fetch;
		const fetchWithHeaders: typeof globalThis.fetch = (input, init) => {
			const mergedHeaders = new Headers(init?.headers);
			if (requestMetadata?.headers !== undefined) {
				for (const [headerName, headerValue] of Object.entries(
					requestMetadata.headers,
				)) {
					mergedHeaders.set(headerName, headerValue);
				}
			}

			return baseFetch(input, {
				...init,
				headers: mergedHeaders,
			});
		};

		const httpClient = new ConvexHttpClient(url, {
			fetch: fetchWithHeaders,
		});

		const auth = wsClient.getAuth();
		if (auth !== undefined) {
			httpClient.setAuth(auth.token);
		}

		return run(httpClient);
	};

	const service: ConvexClientService = {
		query: <Query extends FunctionReference<"query">>(
			query: Query,
			args: Query["_args"],
			requestMetadata?: ConvexRequestMetadata,
		): Effect.Effect<FunctionReturnType<Query>> =>
			Effect.promise(() =>
				callHttpWithMetadata(requestMetadata, (httpClient) =>
					httpClient.query(query, args),
				),
			),

		mutation: <Mutation extends FunctionReference<"mutation">>(
			mutation: Mutation,
			args: Mutation["_args"],
			requestMetadata?: ConvexRequestMetadata,
		): Effect.Effect<FunctionReturnType<Mutation>> =>
			Effect.promise(() =>
				callHttpWithMetadata(requestMetadata, (httpClient) =>
					httpClient.mutation(mutation, args),
				),
			),

		action: <Action extends FunctionReference<"action">>(
			action: Action,
			args: Action["_args"],
			requestMetadata?: ConvexRequestMetadata,
		): Effect.Effect<FunctionReturnType<Action>> =>
			Effect.promise(() =>
				callHttpWithMetadata(requestMetadata, (httpClient) =>
					httpClient.action(action, args),
				),
			),

		subscribe: <Query extends FunctionReference<"query">>(
			query: Query,
			args: Query["_args"],
		): Stream.Stream<FunctionReturnType<Query>> =>
			Stream.async<FunctionReturnType<Query>>((emit) => {
				const unsubscribe = wsClient.onUpdate(query, args, (result) => {
					emit.single(result);
				});
				return Effect.sync(() => {
					unsubscribe();
				});
			}),
	};

	return Layer.succeed(ConvexClient, service);
};
