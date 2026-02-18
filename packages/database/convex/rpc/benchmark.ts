import { Id } from "@packages/confect";
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import {
	type GenericDataModel,
	type GenericMutationCtx,
	type GenericQueryCtx,
	mutationGeneric,
	queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { Effect, Schema } from "effect";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

const Entry = Schema.Struct({
	name: Schema.String,
	message: Schema.String,
});

export const rpcModule = makeRpcModule(
	{
		list: factory.query(
			{
				payload: { nonce: Schema.String },
				success: Schema.Array(Entry),
			},
			() =>
				Effect.gen(function* () {
					const ctx = yield* ConfectQueryCtx;
					const entries = yield* ctx.db.query("guestbook").take(100);
					return entries.map((e) => ({
						name: e.name,
						message: e.message,
					}));
				}),
		),
		add: factory.mutation(
			{
				payload: { name: Schema.String, message: Schema.String },
				success: Id("guestbook"),
			},
			(args) =>
				Effect.gen(function* () {
					const ctx = yield* ConfectMutationCtx;
					return yield* ctx.db.insert("guestbook", {
						name: args.name,
						message: args.message,
					});
				}),
		),
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const { list: rpcList, add: rpcAdd } = rpcModule.handlers;

export const vanillaList = queryGeneric({
	args: { nonce: v.string() },
	returns: v.array(
		v.object({
			name: v.string(),
			message: v.string(),
		}),
	),
	handler: async (ctx: GenericQueryCtx<GenericDataModel>) => {
		const entries = await ctx.db.query("guestbook").take(100);
		return entries.map((e) => ({
			name: String(e.name),
			message: String(e.message),
		}));
	},
});

export const vanillaAdd = mutationGeneric({
	args: { name: v.string(), message: v.string() },
	returns: v.string(),
	handler: async (
		ctx: GenericMutationCtx<GenericDataModel>,
		args: { name: string; message: string },
	) => {
		const id = await ctx.db.insert("guestbook", {
			name: args.name,
			message: args.message,
		});
		return id;
	},
});
