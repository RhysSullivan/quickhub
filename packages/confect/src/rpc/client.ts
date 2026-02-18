import type { Rpc } from "@effect/rpc";
import type {
	FunctionReference,
	RegisteredQuery,
	RegisteredMutation,
	RegisteredAction,
} from "convex/server";
import { Atom, Result } from "@effect-atom/atom";
import * as Cause from "effect/Cause";
import { Chunk, Data, Effect, Exit, FiberId, Layer, Option, Stream } from "effect";

import {
	ConvexClient,
	ConvexClientLayer,
	type ConvexRequestMetadata,
} from "../client";
import type { AnyRpcModule, ExitEncoded, RpcEndpoint } from "./server";
import {
	makeRpcTransportHeaders,
	type RpcClientKind,
	withOptionalRpcTelemetryContext,
} from "./telemetry";

export class RpcDefectError extends Data.TaggedError("RpcDefectError")<{
	readonly defect: unknown;
}> {}

type EndpointPayload<E> = E extends RpcEndpoint<infer _Tag, infer R, infer _ConvexFn>
	? Rpc.Payload<R>
	: never;

type EndpointSuccess<E> = E extends RpcEndpoint<infer _Tag, infer R, infer _ConvexFn>
	? Rpc.Success<R>
	: never;

type EndpointError<E> = E extends RpcEndpoint<infer _Tag, infer R, infer _ConvexFn>
	? Rpc.Error<R>
	: never;

type EndpointKind<E> = E extends RpcEndpoint<infer _Tag, infer _R, infer ConvexFn>
	? ConvexFn extends RegisteredQuery<infer _V, infer _A, infer _R>
		? "query"
		: ConvexFn extends RegisteredMutation<infer _V, infer _A, infer _R>
			? "mutation"
			: ConvexFn extends RegisteredAction<infer _V, infer _A, infer _R>
				? "action"
				: never
	: never;

type IsPaginatedResult<T> = T extends {
	page: ReadonlyArray<infer _Item>;
	isDone: boolean;
	continueCursor: string;
}
	? true
	: false;

type ExtractPageItem<T> = T extends {
	page: ReadonlyArray<infer Item>;
	isDone: boolean;
	continueCursor: string;
}
	? Item
	: never;

type IsPaginatedPayload<T> = T extends {
	cursor: string | null;
	numItems: number;
}
	? true
	: false;

export type RpcQueryClient<Payload, Success, Error> = {
	query: (payload: Payload) => Atom.Atom<Result.Result<Success, Error | RpcDefectError>>;
	queryEffect: (payload: Payload) => Effect.Effect<Success, Error | RpcDefectError>;
	queryPromise: (payload: Payload) => Promise<Success>;
	subscription: (payload: Payload) => Atom.Atom<Result.Result<Success, Error | RpcDefectError>>;
} & (IsPaginatedResult<Success> extends true
	? IsPaginatedPayload<Payload> extends true
		? {
				paginated: (
					numItems: number,
				) => Atom.Writable<
					Atom.PullResult<ExtractPageItem<Success>, Error | RpcDefectError>,
					void
				>;
			}
		: {}
	: {});

export type RpcMutationClient<Payload, Success, Error> = {
	mutate: Atom.AtomResultFn<Payload, Success, Error | RpcDefectError>;
	mutateEffect: (payload: Payload) => Effect.Effect<Success, Error | RpcDefectError>;
	mutatePromise: (payload: Payload) => Promise<Success>;
};

export type RpcActionClient<Payload, Success, Error> = {
	call: Atom.AtomResultFn<Payload, Success, Error | RpcDefectError>;
	callEffect: (payload: Payload) => Effect.Effect<Success, Error | RpcDefectError>;
	callPromise: (payload: Payload) => Promise<Success>;
};

type DecorateEndpoint<E, Shared extends Record<string, unknown> = {}> =
	EndpointKind<E> extends "query"
		? RpcQueryClient<
				Omit<EndpointPayload<E>, keyof Shared>,
				EndpointSuccess<E>,
				EndpointError<E>
			>
		: EndpointKind<E> extends "mutation"
			? RpcMutationClient<
					Omit<EndpointPayload<E>, keyof Shared>,
					EndpointSuccess<E>,
					EndpointError<E>
				>
			: EndpointKind<E> extends "action"
				? RpcActionClient<
						Omit<EndpointPayload<E>, keyof Shared>,
						EndpointSuccess<E>,
						EndpointError<E>
					>
				: never;

type EndpointsRecord = Record<string, RpcEndpoint<string, Rpc.Any, unknown>>;

export type RpcModuleClientMethods<TEndpoints extends EndpointsRecord, Shared extends Record<string, unknown> = {}> = {
	readonly [K in keyof TEndpoints]: DecorateEndpoint<TEndpoints[K], Shared>;
};

export interface RpcModuleClientConfig {
	readonly url: string;
	readonly layer?: Layer.Layer<ConvexClient>;
	readonly enablePayloadTelemetryFallback?: boolean;
}

type ConvexApiModule = Record<string, FunctionReference<"query" | "mutation" | "action">>;

type DecorateModuleEndpoints<TModule extends AnyRpcModule, Shared extends Record<string, unknown>> = {
	[K in keyof TModule]: TModule[K] extends RpcEndpoint<string, Rpc.Any, unknown>
		? DecorateEndpoint<TModule[K], Shared>
		: never;
};

type ExtractDecoratedEndpoints<TModule extends AnyRpcModule, Shared extends Record<string, unknown>> = 
	Pick<DecorateModuleEndpoints<TModule, Shared>, {
		[K in keyof TModule]: TModule[K] extends RpcEndpoint<string, Rpc.Any, unknown> ? K : never;
	}[keyof TModule]>;

export type RpcModuleClient<
	TModule extends AnyRpcModule,
	Shared extends Record<string, unknown> = {},
> = {
	readonly runtime: Atom.AtomRuntime<ConvexClient>;
} & ExtractDecoratedEndpoints<TModule, Shared>;

type CauseEncoded<E = unknown, D = unknown> =
	| { readonly _tag: "Empty" }
	| { readonly _tag: "Fail"; readonly error: E }
	| { readonly _tag: "Die"; readonly defect: D }
	| { readonly _tag: "Interrupt"; readonly fiberId: unknown }
	| { readonly _tag: "Sequential"; readonly left: CauseEncoded<E, D>; readonly right: CauseEncoded<E, D> }
	| { readonly _tag: "Parallel"; readonly left: CauseEncoded<E, D>; readonly right: CauseEncoded<E, D> };

const decodeCause = (encoded: CauseEncoded): Cause.Cause<unknown> => {
	switch (encoded._tag) {
		case "Empty":
			return Cause.empty;
		case "Fail":
			return Cause.fail(encoded.error);
		case "Die":
			return Cause.die(encoded.defect);
		case "Interrupt":
			return Cause.interrupt(FiberId.none);
		case "Sequential":
			return Cause.sequential(decodeCause(encoded.left), decodeCause(encoded.right));
		case "Parallel":
			return Cause.parallel(decodeCause(encoded.left), decodeCause(encoded.right));
	}
};

const decodeExit = (encoded: ExitEncoded): Exit.Exit<unknown, unknown> => {
	if (encoded._tag === "Success") {
		return Exit.succeed(encoded.value);
	}
	const cause = decodeCause(encoded.cause);
	const failureOption = Cause.failureOption(cause);
	if (Option.isSome(failureOption)) {
		return Exit.fail(failureOption.value);
	}
	const defects = Cause.defects(cause);
	if (Chunk.isNonEmpty(defects)) {
		return Exit.fail(new RpcDefectError({ defect: Chunk.unsafeHead(defects) }));
	}
	if (Cause.isInterrupted(cause)) {
		return Exit.fail(new RpcDefectError({ defect: "Interrupted" }));
	}
	return Exit.fail(new RpcDefectError({ defect: "Empty cause" }));
};

const withRpcClientSpan = <A>(
	kind: RpcClientKind,
	endpointTag: string,
	payload: unknown,
	enablePayloadTelemetryFallback: boolean,
	run: (
		payloadWithTelemetry: unknown,
		requestMetadata: ConvexRequestMetadata,
	) => Effect.Effect<A, unknown, ConvexClient>,
): Effect.Effect<A, unknown, ConvexClient> =>
	Effect.useSpan(
		`rpc.client.${kind}.${endpointTag}`,
		{
			kind: "client",
			captureStackTrace: false,
			attributes: {
				"rpc.system": "convex",
				"rpc.method": endpointTag,
				"rpc.confect.kind": kind,
			},
		},
		(span) => {
			const requestMetadata: ConvexRequestMetadata = {
				headers: makeRpcTransportHeaders(span),
			};
			return run(
				withOptionalRpcTelemetryContext(
					kind,
					payload,
					span,
					enablePayloadTelemetryFallback,
				),
				requestMetadata,
			);
		},
	);

const createQueryEffect = (
	endpointTag: string,
	convexFn: FunctionReference<"query">,
	payload: unknown,
	enablePayloadTelemetryFallback: boolean,
): Effect.Effect<unknown, unknown, ConvexClient> =>
	withRpcClientSpan(
		"query",
		endpointTag,
		payload,
		enablePayloadTelemetryFallback,
		(payloadWithTelemetry, requestMetadata) =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;
			const encodedExit = yield* client.query(
				convexFn,
				payloadWithTelemetry,
				requestMetadata,
			);
			const exit = decodeExit(encodedExit as ExitEncoded);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		}),
	);

const createMutationEffect = (
	endpointTag: string,
	convexFn: FunctionReference<"mutation">,
	payload: unknown,
	enablePayloadTelemetryFallback: boolean,
): Effect.Effect<unknown, unknown, ConvexClient> =>
	withRpcClientSpan(
		"mutation",
		endpointTag,
		payload,
		enablePayloadTelemetryFallback,
		(payloadWithTelemetry, requestMetadata) =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;
			const encodedExit = yield* client.mutation(
				convexFn,
				payloadWithTelemetry,
				requestMetadata,
			);
			const exit = decodeExit(encodedExit as ExitEncoded);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		}),
	);

const createActionEffect = (
	endpointTag: string,
	convexFn: FunctionReference<"action">,
	payload: unknown,
	enablePayloadTelemetryFallback: boolean,
): Effect.Effect<unknown, unknown, ConvexClient> =>
	withRpcClientSpan(
		"action",
		endpointTag,
		payload,
		enablePayloadTelemetryFallback,
		(payloadWithTelemetry, requestMetadata) =>
		Effect.gen(function* () {
			const client = yield* ConvexClient;
			const encodedExit = yield* client.action(
				convexFn,
				payloadWithTelemetry,
				requestMetadata,
			);
			const exit = decodeExit(encodedExit as ExitEncoded);
			if (Exit.isSuccess(exit)) {
				return exit.value;
			}
			return yield* exit;
		}),
	);

const createQueryAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	endpointTag: string,
	convexFn: FunctionReference<"query">,
	payload: unknown,
	enablePayloadTelemetryFallback: boolean,
): Atom.Atom<Result.Result<unknown, unknown>> => {
	return runtime.atom(
		createQueryEffect(
			endpointTag,
			convexFn,
			payload,
			enablePayloadTelemetryFallback,
		),
	);
};

const createSubscriptionAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	endpointTag: string,
	convexFn: FunctionReference<"query">,
	payload: unknown,
	enablePayloadTelemetryFallback: boolean,
): Atom.Atom<Result.Result<unknown, unknown>> => {
	return runtime.atom(
		Stream.unwrap(
			withRpcClientSpan(
				"query",
				endpointTag,
				payload,
				enablePayloadTelemetryFallback,
				(payloadWithTelemetry, _requestMetadata) =>
					Effect.gen(function* () {
						const client = yield* ConvexClient;
						return client.subscribe(convexFn, payloadWithTelemetry).pipe(
							Stream.mapEffect((encodedExit) => {
								const exit = decodeExit(encodedExit as ExitEncoded);
								if (Exit.isSuccess(exit)) {
									return Effect.succeed(exit.value);
								}
								return exit;
							}),
						);
					}),
			),
		),
	);
};

const createMutationFn = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	endpointTag: string,
	convexFn: FunctionReference<"mutation">,
	getShared: () => Record<string, unknown>,
	enablePayloadTelemetryFallback: boolean,
): Atom.AtomResultFn<unknown, unknown, unknown> => {
	return runtime.fn<unknown>()(
		Effect.fnUntraced(function* (payload) {
			const fullPayload = { ...getShared(), ...(payload as object) };
			return yield* createMutationEffect(
				endpointTag,
				convexFn,
				fullPayload,
				enablePayloadTelemetryFallback,
			);
		}),
	);
};

const createActionFn = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	endpointTag: string,
	convexFn: FunctionReference<"action">,
	getShared: () => Record<string, unknown>,
	enablePayloadTelemetryFallback: boolean,
): Atom.AtomResultFn<unknown, unknown, unknown> => {
	return runtime.fn<unknown>()(
		Effect.fnUntraced(function* (payload) {
			const fullPayload = { ...getShared(), ...(payload as object) };
			return yield* createActionEffect(
				endpointTag,
				convexFn,
				fullPayload,
				enablePayloadTelemetryFallback,
			);
		}),
	);
};

interface PaginatedResult<T> {
	page: ReadonlyArray<T>;
	isDone: boolean;
	continueCursor: string;
}

const createPaginatedAtom = (
	runtime: Atom.AtomRuntime<ConvexClient>,
	endpointTag: string,
	convexFn: FunctionReference<"query">,
	getShared: () => Record<string, unknown>,
	numItems: number,
	enablePayloadTelemetryFallback: boolean,
): Atom.Writable<Atom.PullResult<unknown, unknown>, void> => {
	return runtime.pull(
		Stream.paginateChunkEffect(null as string | null, (cursor) =>
			Effect.gen(function* () {
				const fullPayload = {
					...getShared(),
					cursor,
					numItems,
				};
				const result = (yield* createQueryEffect(
					endpointTag,
					convexFn,
					fullPayload,
					enablePayloadTelemetryFallback,
				)) as PaginatedResult<unknown>;
				const nextCursor = result.isDone
					? Option.none<string | null>()
					: Option.some(result.continueCursor);

				return [Chunk.fromIterable(result.page), nextCursor] as const;
			}),
		),
	);
};

const noop = () => {};

export function createRpcClient<
	TModule extends AnyRpcModule,
	Shared extends Record<string, unknown> = {},
>(
	convexApi: ConvexApiModule,
	config: RpcModuleClientConfig,
	getShared: () => Shared = () => ({}) as Shared,
): RpcModuleClient<TModule, Shared> {
	const baseLayer = config.layer ?? ConvexClientLayer(config.url);
	const enablePayloadTelemetryFallback =
		config.enablePayloadTelemetryFallback ?? true;
	const runtime = Atom.runtime(baseLayer);

	const queryFamilies = new Map<string, (payload: unknown) => Atom.Atom<Result.Result<unknown, unknown>>>();
	const subscriptionFamilies = new Map<string, (payload: unknown) => Atom.Atom<Result.Result<unknown, unknown>>>();
	const mutationFns = new Map<string, Atom.AtomResultFn<unknown, unknown, unknown>>();
	const actionFns = new Map<string, Atom.AtomResultFn<unknown, unknown, unknown>>();
	const paginatedFamilies = new Map<string, (numItems: number) => Atom.Writable<Atom.PullResult<unknown, unknown>, void>>();

	const getQueryFamily = (tag: string) => {
		let family = queryFamilies.get(tag);
		if (!family) {
			const convexFn = convexApi[tag] as FunctionReference<"query">;
			family = Atom.family((p: unknown) => {
				const fullPayload = { ...getShared(), ...(p as object) };
				return createQueryAtom(
					runtime,
					tag,
					convexFn,
					fullPayload,
					enablePayloadTelemetryFallback,
				);
			});
			queryFamilies.set(tag, family);
		}
		return family;
	};

	const getSubscriptionFamily = (tag: string) => {
		let family = subscriptionFamilies.get(tag);
		if (!family) {
			const convexFn = convexApi[tag] as FunctionReference<"query">;
			family = Atom.family((p: unknown) => {
				const fullPayload = { ...getShared(), ...(p as object) };
				return createSubscriptionAtom(
					runtime,
					tag,
					convexFn,
					fullPayload,
					enablePayloadTelemetryFallback,
				);
			});
			subscriptionFamilies.set(tag, family);
		}
		return family;
	};

	const getMutationFn = (tag: string) => {
		let fn = mutationFns.get(tag);
		if (!fn) {
			const convexFn = convexApi[tag] as FunctionReference<"mutation">;
			fn = createMutationFn(
				runtime,
				tag,
				convexFn,
				getShared,
				enablePayloadTelemetryFallback,
			);
			mutationFns.set(tag, fn);
		}
		return fn;
	};

	const getActionFn = (tag: string) => {
		let fn = actionFns.get(tag);
		if (!fn) {
			const convexFn = convexApi[tag] as FunctionReference<"action">;
			fn = createActionFn(
				runtime,
				tag,
				convexFn,
				getShared,
				enablePayloadTelemetryFallback,
			);
			actionFns.set(tag, fn);
		}
		return fn;
	};

	const getPaginatedFamily = (tag: string) => {
		let family = paginatedFamilies.get(tag);
		if (!family) {
			const convexFn = convexApi[tag] as FunctionReference<"query">;
			family = Atom.family((numItems: number) =>
				createPaginatedAtom(
					runtime,
					tag,
					convexFn,
					getShared,
					numItems,
					enablePayloadTelemetryFallback,
				),
			);
			paginatedFamilies.set(tag, family);
		}
		return family;
	};

	const endpointProxyCache = new Map<string, unknown>();

	const proxy = new Proxy(noop, {
		get(_target, prop) {
			if (prop === "runtime") {
				return runtime;
			}
			if (prop === "then") {
				return undefined;
			}
			if (typeof prop !== "string") {
				return undefined;
			}

			let endpointProxy = endpointProxyCache.get(prop);
			if (!endpointProxy) {
				const queryEffect = (payload: unknown) => {
					const convexFn = convexApi[prop] as FunctionReference<"query">;
					const fullPayload = { ...getShared(), ...(payload as object) };
					return createQueryEffect(
						prop,
						convexFn,
						fullPayload,
						enablePayloadTelemetryFallback,
					).pipe(
						Effect.provide(baseLayer),
					);
				};

				const mutateEffect = (payload: unknown) => {
					const convexFn = convexApi[prop] as FunctionReference<"mutation">;
					const fullPayload = { ...getShared(), ...(payload as object) };
					return createMutationEffect(
						prop,
						convexFn,
						fullPayload,
						enablePayloadTelemetryFallback,
					).pipe(
						Effect.provide(baseLayer),
					);
				};

				const callEffect = (payload: unknown) => {
					const convexFn = convexApi[prop] as FunctionReference<"action">;
					const fullPayload = { ...getShared(), ...(payload as object) };
					return createActionEffect(
						prop,
						convexFn,
						fullPayload,
						enablePayloadTelemetryFallback,
					).pipe(
						Effect.provide(baseLayer),
					);
				};

				endpointProxy = {
					query: (payload: unknown) => getQueryFamily(prop)(payload),
					queryEffect,
					queryPromise: (payload: unknown) => Effect.runPromise(queryEffect(payload)),
					subscription: (payload: unknown) => getSubscriptionFamily(prop)(payload),
					mutate: getMutationFn(prop),
					mutateEffect,
					mutatePromise: (payload: unknown) => Effect.runPromise(mutateEffect(payload)),
					call: getActionFn(prop),
					callEffect,
					callPromise: (payload: unknown) => Effect.runPromise(callEffect(payload)),
					paginated: (numItems: number) => getPaginatedFamily(prop)(numItems),
				};
				endpointProxyCache.set(prop, endpointProxy);
			}
			return endpointProxy;
		},
	});

	return proxy as unknown as RpcModuleClient<TModule, Shared>;
}
