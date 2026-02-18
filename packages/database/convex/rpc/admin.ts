import {
	createRpcFactory,
	makeRpcModule,
	middleware,
	RpcMiddleware,
} from "@packages/confect/rpc";
import { Context, Effect, Schema } from "effect";
import { ConfectMutationCtx, ConfectQueryCtx, confectSchema } from "../confect";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
	"UnauthorizedError",
	{ message: Schema.String },
) {}

class AdminContext extends Context.Tag("AdminContext")<
	AdminContext,
	{ verified: true }
>() {}

class AdminMiddleware extends RpcMiddleware.Tag<AdminMiddleware>()(
	"AdminMiddleware",
	{
		provides: AdminContext,
		failure: UnauthorizedError,
	},
) {}

const factory = createRpcFactory({
	schema: confectSchema,
	basePayload: {
		privateAccessKey: Schema.String,
	},
	baseMiddlewares: [AdminMiddleware],
});

const EXPECTED_KEY = process.env.PRIVATE_ACCESS_KEY ?? "dev-secret-key";

const adminMiddlewareImpl = middleware(AdminMiddleware, (options) =>
	Effect.gen(function* () {
		const payload = options.payload as { privateAccessKey: string };

		if (payload.privateAccessKey !== EXPECTED_KEY) {
			return yield* new UnauthorizedError({
				message: "Invalid private access key",
			});
		}

		return { verified: true as const };
	}),
);

const adminModule = makeRpcModule(
	{
		clearGuestbook: factory.mutation(
			{
				success: Schema.Number,
				error: UnauthorizedError,
			},
			() =>
				Effect.gen(function* () {
					yield* AdminContext;
					const ctx = yield* ConfectMutationCtx;
					const entries = yield* ctx.db.query("guestbook").collect();
					for (const entry of entries) {
						yield* ctx.db.delete(entry._id);
					}
					return entries.length;
				}),
		),

		getStats: factory.query(
			{
				success: Schema.Struct({
					guestbookCount: Schema.Number,
				}),
				error: UnauthorizedError,
			},
			() =>
				Effect.gen(function* () {
					yield* AdminContext;
					const ctx = yield* ConfectQueryCtx;
					const entries = yield* ctx.db.query("guestbook").collect();
					return { guestbookCount: entries.length };
				}),
		),
	},
	{
		middlewares: {
			implementations: [adminMiddlewareImpl],
			layer: DatabaseRpcTelemetryLayer,
		},
	},
);

export const { clearGuestbook, getStats } = adminModule.handlers;
export { adminModule, UnauthorizedError, AdminMiddleware };
export type AdminModule = typeof adminModule;
