import {
	type MiddlewareImplementation,
	type MiddlewareOptions,
	middleware,
	RpcMiddleware,
} from "@packages/confect/rpc";
import { Context, Effect, Either, Schema } from "effect";
import { internal } from "../_generated/api";
import { authComponent } from "../auth";
import { RepoPermissionLevelSchema } from "../shared/permissions";

type RepoPermissionLevel = Schema.Schema.Type<typeof RepoPermissionLevelSchema>;

const RepoByIdPayloadSchema = Schema.Struct({
	repositoryId: Schema.Number,
});

const RepoByNamePayloadSchema = Schema.Struct({
	ownerLogin: Schema.String,
	name: Schema.String,
});

const AdminTokenPayloadSchema = Schema.Struct({
	adminToken: Schema.String,
});

const RepoInfoByNameSchema = Schema.Struct({
	found: Schema.Boolean,
	repositoryId: Schema.optional(Schema.Number),
	installationId: Schema.optional(Schema.Number),
	isPrivate: Schema.optional(Schema.Boolean),
});

const RepoInfoByIdSchema = Schema.Struct({
	found: Schema.Boolean,
	ownerLogin: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
	installationId: Schema.optional(Schema.Number),
	isPrivate: Schema.optional(Schema.Boolean),
});

const RepoInfoByNameSuccessResponseSchema = Schema.Struct({
	_tag: Schema.Literal("Success"),
	value: RepoInfoByNameSchema,
});

const RepoInfoByIdSuccessResponseSchema = Schema.Struct({
	_tag: Schema.Literal("Success"),
	value: RepoInfoByIdSchema,
});

const BooleanSuccessResponseSchema = Schema.Struct({
	_tag: Schema.Literal("Success"),
	value: Schema.Boolean,
});

const RepoInfoByNameResponseSchema = Schema.Union(
	RepoInfoByNameSchema,
	RepoInfoByNameSuccessResponseSchema,
);

const RepoInfoByIdResponseSchema = Schema.Union(
	RepoInfoByIdSchema,
	RepoInfoByIdSuccessResponseSchema,
);

const BooleanResponseSchema = Schema.Union(
	Schema.Boolean,
	BooleanSuccessResponseSchema,
);

const decodeRepoByIdPayload = Schema.decodeUnknownEither(RepoByIdPayloadSchema);
const decodeRepoByNamePayload = Schema.decodeUnknownEither(
	RepoByNamePayloadSchema,
);
const decodeAdminTokenPayload = Schema.decodeUnknownEither(
	AdminTokenPayloadSchema,
);
const decodeRepoInfoByNameResponse = Schema.decodeUnknownEither(
	RepoInfoByNameResponseSchema,
);
const decodeRepoInfoByIdResponse = Schema.decodeUnknownEither(
	RepoInfoByIdResponseSchema,
);
const decodeBooleanResponse = Schema.decodeUnknownEither(BooleanResponseSchema);

const isRepoInfoByNameSuccessResponse = Schema.is(
	RepoInfoByNameSuccessResponseSchema,
);
const isRepoInfoByIdSuccessResponse = Schema.is(
	RepoInfoByIdSuccessResponseSchema,
);
const isBooleanSuccessResponse = Schema.is(BooleanSuccessResponseSchema);

const unwrapRepoInfoByNameResponse = (
	response: Schema.Schema.Type<typeof RepoInfoByNameResponseSchema>,
): Schema.Schema.Type<typeof RepoInfoByNameSchema> => {
	if (isRepoInfoByNameSuccessResponse(response)) {
		return response.value;
	}

	return response;
};

const unwrapRepoInfoByIdResponse = (
	response: Schema.Schema.Type<typeof RepoInfoByIdResponseSchema>,
): Schema.Schema.Type<typeof RepoInfoByIdSchema> => {
	if (isRepoInfoByIdSuccessResponse(response)) {
		return response.value;
	}

	return response;
};

const unwrapBooleanResponse = (
	response: Schema.Schema.Type<typeof BooleanResponseSchema>,
): boolean => {
	if (isBooleanSuccessResponse(response)) {
		return response.value;
	}

	return response;
};

type RepoPermissionContextValue = {
	repositoryId: number;
	ownerLogin: string;
	name: string;
	installationId: number;
	isPrivate: boolean;
	required: RepoPermissionLevel;
	userId: string | null;
};

type RepoSummary = {
	repositoryId: number;
	ownerLogin: string;
	name: string;
	installationId: number;
	isPrivate: boolean;
};

type ReadGitHubRepoPermissionValue = {
	isAllowed: boolean;
	reason:
		| "allowed"
		| "repo_not_found"
		| "not_authenticated"
		| "insufficient_permission"
		| "invalid_payload"
		| "invalid_repo_info";
	userId: string | null;
	repository: RepoSummary | null;
};

export class RepoPermissionContext extends Context.Tag(
	"@fastergh/RepoPermissionContext",
)<RepoPermissionContext, RepoPermissionContextValue>() {}

export class ReadGitHubRepoPermission extends Context.Tag(
	"@fastergh/ReadGitHubRepoPermission",
)<ReadGitHubRepoPermission, ReadGitHubRepoPermissionValue>() {}

type AuthenticatedUserValue = {
	userId: string;
};

type VerifiedAdminTokenValue = {
	verified: true;
};

type AuthenticatedAdminUserValue = {
	userId: string;
	role: string | null;
};

export class AuthenticatedUser extends Context.Tag(
	"@fastergh/AuthenticatedUser",
)<AuthenticatedUser, AuthenticatedUserValue>() {}

export class VerifiedAdminToken extends Context.Tag(
	"@fastergh/VerifiedAdminToken",
)<VerifiedAdminToken, VerifiedAdminTokenValue>() {}

export class AuthenticatedAdminUser extends Context.Tag(
	"@fastergh/AuthenticatedAdminUser",
)<AuthenticatedAdminUser, AuthenticatedAdminUserValue>() {}

export class AdminAccessViolation extends Schema.TaggedError<AdminAccessViolation>()(
	"AdminAccessViolation",
	{
		reason: Schema.Literal(
			"missing_config",
			"invalid_payload",
			"invalid_token",
		),
		message: Schema.String,
	},
) {}

export class AdminRoleAccessViolation extends Schema.TaggedError<AdminRoleAccessViolation>()(
	"AdminRoleAccessViolation",
	{
		reason: Schema.Literal(
			"not_authenticated",
			"missing_admin_role",
			"invalid_identity",
		),
		message: Schema.String,
		userId: Schema.NullOr(Schema.String),
		role: Schema.NullOr(Schema.String),
	},
) {}

export class RepoAccessViolation extends Schema.TaggedError<RepoAccessViolation>()(
	"RepoAccessViolation",
	{
		reason: Schema.Literal(
			"invalid_payload",
			"repo_not_found",
			"not_authenticated",
			"insufficient_permission",
			"invalid_repo_info",
		),
		message: Schema.String,
		repositoryId: Schema.NullOr(Schema.Number),
		ownerLogin: Schema.NullOr(Schema.String),
		name: Schema.NullOr(Schema.String),
		required: RepoPermissionLevelSchema,
		userId: Schema.NullOr(Schema.String),
	},
) {}

const parseUserId = (
	identity: {
		subject?: string;
	} | null,
): string | null => {
	if (identity === null) return null;
	if (identity.subject === undefined) return null;
	if (identity.subject.length === 0) return null;
	return identity.subject;
};

const resolveIdentityUserId = (options: MiddlewareOptions) =>
	Effect.gen(function* () {
		const identity = yield* Effect.promise(() =>
			options.ctx.auth.getUserIdentity(),
		).pipe(Effect.orDie);
		return parseUserId(identity);
	});

const ensureRepoPermission = (
	options: MiddlewareOptions,
	repositoryId: number,
	isPrivate: boolean,
	required: RepoPermissionLevel,
	userId: string | null,
	requireAuthenticated: boolean,
	ownerLogin: string | null,
	name: string | null,
): Effect.Effect<boolean, RepoAccessViolation> =>
	Effect.gen(function* () {
		const hasPermissionRaw = yield* Effect.promise(() =>
			options.ctx.runQuery(internal.rpc.codeBrowse.hasRepoPermission, {
				repositoryId,
				isPrivate,
				userId,
				required,
				requireAuthenticated,
			}),
		).pipe(Effect.orDie);

		const hasPermission = decodeBooleanResponse(hasPermissionRaw);
		if (
			Either.isLeft(hasPermission) ||
			!unwrapBooleanResponse(hasPermission.right)
		) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason:
						userId === null ? "not_authenticated" : "insufficient_permission",
					message:
						userId === null
							? "Authentication is required"
							: `Missing required repository permission: ${required}`,
					repositoryId,
					ownerLogin,
					name,
					required,
					userId,
				}),
			);
		}

		return true;
	});

const authorizeRepoById = (
	options: MiddlewareOptions,
	required: RepoPermissionLevel,
	requireAuthenticated: boolean,
): Effect.Effect<RepoPermissionContextValue, RepoAccessViolation> =>
	Effect.gen(function* () {
		const decodedPayload = decodeRepoByIdPayload(options.payload);
		if (Either.isLeft(decodedPayload)) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason: "invalid_payload",
					message: "Expected payload to include repositoryId",
					repositoryId: null,
					ownerLogin: null,
					name: null,
					required,
					userId: null,
				}),
			);
		}

		const repositoryId = decodedPayload.right.repositoryId;
		const repoInfoRaw = yield* Effect.promise(() =>
			options.ctx.runQuery(internal.rpc.codeBrowse.getRepoInfoById, {
				repositoryId,
			}),
		).pipe(Effect.orDie);

		const repoInfoResponse = decodeRepoInfoByIdResponse(repoInfoRaw);
		if (Either.isLeft(repoInfoResponse)) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason: "invalid_repo_info",
					message: "Repository metadata is incomplete",
					repositoryId,
					ownerLogin: null,
					name: null,
					required,
					userId: null,
				}),
			);
		}

		const repoInfo = unwrapRepoInfoByIdResponse(repoInfoResponse.right);
		if (!repoInfo.found) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason: "repo_not_found",
					message: "Repository not found",
					repositoryId,
					ownerLogin: null,
					name: null,
					required,
					userId: null,
				}),
			);
		}

		const ownerLogin = repoInfo.ownerLogin;
		const name = repoInfo.name;
		if (ownerLogin === undefined || name === undefined) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason: "invalid_repo_info",
					message: "Repository metadata is incomplete",
					repositoryId,
					ownerLogin: null,
					name: null,
					required,
					userId: null,
				}),
			);
		}

		const userId = yield* resolveIdentityUserId(options);
		if (requireAuthenticated && userId === null) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason: "not_authenticated",
					message: "Authentication is required",
					repositoryId,
					ownerLogin,
					name,
					required,
					userId: null,
				}),
			);
		}

		const isPrivate = repoInfo.isPrivate ?? true;
		yield* ensureRepoPermission(
			options,
			repositoryId,
			isPrivate,
			required,
			userId,
			requireAuthenticated,
			ownerLogin,
			name,
		);

		return {
			repositoryId,
			ownerLogin,
			name,
			installationId: repoInfo.installationId ?? 0,
			isPrivate,
			required,
			userId,
		};
	});

const authorizeRepoByName = (
	options: MiddlewareOptions,
	required: RepoPermissionLevel,
	requireAuthenticated: boolean,
): Effect.Effect<RepoPermissionContextValue, RepoAccessViolation> =>
	Effect.gen(function* () {
		const decodedPayload = decodeRepoByNamePayload(options.payload);
		if (Either.isLeft(decodedPayload)) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason: "invalid_payload",
					message: "Expected payload to include ownerLogin and name",
					repositoryId: null,
					ownerLogin: null,
					name: null,
					required,
					userId: null,
				}),
			);
		}

		const ownerLogin = decodedPayload.right.ownerLogin;
		const name = decodedPayload.right.name;

		const repoInfoRaw = yield* Effect.promise(() =>
			options.ctx.runQuery(internal.rpc.codeBrowse.getRepoInfo, {
				ownerLogin,
				name,
			}),
		).pipe(Effect.orDie);

		const repoInfoResponse = decodeRepoInfoByNameResponse(repoInfoRaw);
		if (Either.isLeft(repoInfoResponse)) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason: "invalid_repo_info",
					message: "Repository metadata is incomplete",
					repositoryId: null,
					ownerLogin,
					name,
					required,
					userId: null,
				}),
			);
		}

		const repoInfo = unwrapRepoInfoByNameResponse(repoInfoResponse.right);
		if (!repoInfo.found) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason: "repo_not_found",
					message: "Repository not found",
					repositoryId: null,
					ownerLogin,
					name,
					required,
					userId: null,
				}),
			);
		}

		const repositoryId = repoInfo.repositoryId;
		if (repositoryId === undefined) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason: "invalid_repo_info",
					message: "Repository metadata is incomplete",
					repositoryId: null,
					ownerLogin,
					name,
					required,
					userId: null,
				}),
			);
		}

		const userId = yield* resolveIdentityUserId(options);
		if (requireAuthenticated && userId === null) {
			return yield* Effect.die(
				new RepoAccessViolation({
					reason: "not_authenticated",
					message: "Authentication is required",
					repositoryId,
					ownerLogin,
					name,
					required,
					userId: null,
				}),
			);
		}

		const isPrivate = repoInfo.isPrivate ?? true;
		yield* ensureRepoPermission(
			options,
			repositoryId,
			isPrivate,
			required,
			userId,
			requireAuthenticated,
			ownerLogin,
			name,
		);

		return {
			repositoryId,
			ownerLogin,
			name,
			installationId: repoInfo.installationId ?? 0,
			isPrivate,
			required,
			userId,
		};
	});

const buildRepoSummaryByName = (
	ownerLogin: string,
	name: string,
	repositoryId: number,
	installationId: number,
	isPrivate: boolean,
): RepoSummary => ({
	repositoryId,
	ownerLogin,
	name,
	installationId,
	isPrivate,
});

const checkReadPermission = (
	options: MiddlewareOptions,
	repositoryId: number,
	isPrivate: boolean,
	userId: string | null,
) =>
	Effect.gen(function* () {
		const hasPermissionRaw = yield* Effect.promise(() =>
			options.ctx.runQuery(internal.rpc.codeBrowse.hasRepoPermission, {
				repositoryId,
				isPrivate,
				userId,
				required: "pull",
				requireAuthenticated: false,
			}),
		).pipe(Effect.orDie);

		const hasPermission = decodeBooleanResponse(hasPermissionRaw);
		if (Either.isLeft(hasPermission)) {
			return false;
		}

		return unwrapBooleanResponse(hasPermission.right);
	});

const authorizeReadRepoByName = (
	options: MiddlewareOptions,
): Effect.Effect<ReadGitHubRepoPermissionValue> =>
	Effect.gen(function* () {
		const userId = yield* resolveIdentityUserId(options);
		const decodedPayload = decodeRepoByNamePayload(options.payload);

		if (Either.isLeft(decodedPayload)) {
			return {
				isAllowed: false,
				reason: "invalid_payload",
				userId,
				repository: null,
			};
		}

		const ownerLogin = decodedPayload.right.ownerLogin;
		const name = decodedPayload.right.name;
		const repoInfoRaw = yield* Effect.promise(() =>
			options.ctx.runQuery(internal.rpc.codeBrowse.getRepoInfo, {
				ownerLogin,
				name,
			}),
		).pipe(Effect.orDie);

		const repoInfoResponse = decodeRepoInfoByNameResponse(repoInfoRaw);
		if (Either.isLeft(repoInfoResponse)) {
			return {
				isAllowed: false,
				reason: "invalid_repo_info",
				userId,
				repository: null,
			};
		}

		const repoInfo = unwrapRepoInfoByNameResponse(repoInfoResponse.right);
		if (!repoInfo.found) {
			return {
				isAllowed: false,
				reason: "repo_not_found",
				userId,
				repository: null,
			};
		}

		const repositoryId = repoInfo.repositoryId;
		if (repositoryId === undefined) {
			return {
				isAllowed: false,
				reason: "invalid_repo_info",
				userId,
				repository: null,
			};
		}

		const isPrivate = repoInfo.isPrivate ?? true;
		const repository = buildRepoSummaryByName(
			ownerLogin,
			name,
			repositoryId,
			repoInfo.installationId ?? 0,
			isPrivate,
		);

		const hasPermission = yield* checkReadPermission(
			options,
			repositoryId,
			isPrivate,
			userId,
		);

		if (!hasPermission) {
			return {
				isAllowed: false,
				reason:
					userId === null ? "not_authenticated" : "insufficient_permission",
				userId,
				repository,
			};
		}

		return {
			isAllowed: true,
			reason: "allowed",
			userId,
			repository,
		};
	});

const authorizeReadRepoById = (
	options: MiddlewareOptions,
): Effect.Effect<ReadGitHubRepoPermissionValue> =>
	Effect.gen(function* () {
		const userId = yield* resolveIdentityUserId(options);
		const decodedPayload = decodeRepoByIdPayload(options.payload);

		if (Either.isLeft(decodedPayload)) {
			return {
				isAllowed: false,
				reason: "invalid_payload",
				userId,
				repository: null,
			};
		}

		const repositoryId = decodedPayload.right.repositoryId;
		const repoInfoRaw = yield* Effect.promise(() =>
			options.ctx.runQuery(internal.rpc.codeBrowse.getRepoInfoById, {
				repositoryId,
			}),
		).pipe(Effect.orDie);

		const repoInfoResponse = decodeRepoInfoByIdResponse(repoInfoRaw);
		if (Either.isLeft(repoInfoResponse)) {
			return {
				isAllowed: false,
				reason: "invalid_repo_info",
				userId,
				repository: null,
			};
		}

		const repoInfo = unwrapRepoInfoByIdResponse(repoInfoResponse.right);
		if (!repoInfo.found) {
			return {
				isAllowed: false,
				reason: "repo_not_found",
				userId,
				repository: null,
			};
		}

		const ownerLogin = repoInfo.ownerLogin;
		const name = repoInfo.name;
		if (ownerLogin === undefined || name === undefined) {
			return {
				isAllowed: false,
				reason: "invalid_repo_info",
				userId,
				repository: null,
			};
		}

		const isPrivate = repoInfo.isPrivate ?? true;
		const repository = buildRepoSummaryByName(
			ownerLogin,
			name,
			repositoryId,
			repoInfo.installationId ?? 0,
			isPrivate,
		);

		const hasPermission = yield* checkReadPermission(
			options,
			repositoryId,
			isPrivate,
			userId,
		);

		if (!hasPermission) {
			return {
				isAllowed: false,
				reason:
					userId === null ? "not_authenticated" : "insufficient_permission",
				userId,
				repository,
			};
		}

		return {
			isAllowed: true,
			reason: "allowed",
			userId,
			repository,
		};
	});

const authorizeAdminToken = (
	options: MiddlewareOptions,
): Effect.Effect<VerifiedAdminTokenValue, AdminAccessViolation> =>
	Effect.gen(function* () {
		const decodedPayload = decodeAdminTokenPayload(options.payload);
		if (Either.isLeft(decodedPayload)) {
			return yield* Effect.die(
				new AdminAccessViolation({
					reason: "invalid_payload",
					message: "Expected payload to include adminToken",
				}),
			);
		}

		const configuredToken = process.env.BACKEND_ACCESS_TOKEN;
		if (
			configuredToken === undefined ||
			configuredToken === "" ||
			configuredToken === "generate-a-random-token-here"
		) {
			return yield* Effect.die(
				new AdminAccessViolation({
					reason: "missing_config",
					message: "BACKEND_ACCESS_TOKEN is not configured",
				}),
			);
		}

		if (decodedPayload.right.adminToken !== configuredToken) {
			return yield* Effect.die(
				new AdminAccessViolation({
					reason: "invalid_token",
					message: "Invalid admin token",
				}),
			);
		}

		return { verified: true };
	});

const authorizeAdminRole = (
	options: MiddlewareOptions,
): Effect.Effect<AuthenticatedAdminUserValue, AdminRoleAccessViolation> =>
	Effect.gen(function* () {
		const user = yield* Effect.promise(() =>
			authComponent.safeGetAuthUser(options.ctx),
		).pipe(Effect.orDie);

		if (user === null || user === undefined) {
			return yield* Effect.die(
				new AdminRoleAccessViolation({
					reason: "not_authenticated",
					message: "Authentication is required",
					userId: null,
					role: null,
				}),
			);
		}

		const role = user.role ?? null;
		const userId = user._id;

		if (role !== "admin") {
			return yield* Effect.die(
				new AdminRoleAccessViolation({
					reason: "missing_admin_role",
					message: "Admin role is required (role=admin)",
					userId,
					role,
				}),
			);
		}

		return { userId, role };
	});

export class RequireAuthenticatedMiddleware extends RpcMiddleware.Tag<RequireAuthenticatedMiddleware>()(
	"RequireAuthenticatedMiddleware",
	{
		provides: AuthenticatedUser,
		failure: RepoAccessViolation,
	},
) {}

export class AdminTokenMiddleware extends RpcMiddleware.Tag<AdminTokenMiddleware>()(
	"AdminTokenMiddleware",
	{
		provides: VerifiedAdminToken,
		failure: AdminAccessViolation,
	},
) {}

export class RequireAdminRoleMiddleware extends RpcMiddleware.Tag<RequireAdminRoleMiddleware>()(
	"RequireAdminRoleMiddleware",
	{
		provides: AuthenticatedAdminUser,
		failure: AdminRoleAccessViolation,
	},
) {}

export class ReadGitHubRepoByIdMiddleware extends RpcMiddleware.Tag<ReadGitHubRepoByIdMiddleware>()(
	"ReadGitHubRepoByIdMiddleware",
	{
		provides: ReadGitHubRepoPermission,
	},
) {}

export class ReadGitHubRepoByNameMiddleware extends RpcMiddleware.Tag<ReadGitHubRepoByNameMiddleware>()(
	"ReadGitHubRepoByNameMiddleware",
	{
		provides: ReadGitHubRepoPermission,
	},
) {}

export class RepoPullByIdMiddleware extends RpcMiddleware.Tag<RepoPullByIdMiddleware>()(
	"RepoPullByIdMiddleware",
	{
		provides: RepoPermissionContext,
		failure: RepoAccessViolation,
	},
) {}

export class RepoTriageByIdMiddleware extends RpcMiddleware.Tag<RepoTriageByIdMiddleware>()(
	"RepoTriageByIdMiddleware",
	{
		provides: RepoPermissionContext,
		failure: RepoAccessViolation,
	},
) {}

export class RepoPushByIdMiddleware extends RpcMiddleware.Tag<RepoPushByIdMiddleware>()(
	"RepoPushByIdMiddleware",
	{
		provides: RepoPermissionContext,
		failure: RepoAccessViolation,
	},
) {}

export class RepoMaintainByIdMiddleware extends RpcMiddleware.Tag<RepoMaintainByIdMiddleware>()(
	"RepoMaintainByIdMiddleware",
	{
		provides: RepoPermissionContext,
		failure: RepoAccessViolation,
	},
) {}

export class RepoAdminByIdMiddleware extends RpcMiddleware.Tag<RepoAdminByIdMiddleware>()(
	"RepoAdminByIdMiddleware",
	{
		provides: RepoPermissionContext,
		failure: RepoAccessViolation,
	},
) {}

export class RepoPullByNameMiddleware extends RpcMiddleware.Tag<RepoPullByNameMiddleware>()(
	"RepoPullByNameMiddleware",
	{
		provides: RepoPermissionContext,
		failure: RepoAccessViolation,
	},
) {}

export class RepoTriageByNameMiddleware extends RpcMiddleware.Tag<RepoTriageByNameMiddleware>()(
	"RepoTriageByNameMiddleware",
	{
		provides: RepoPermissionContext,
		failure: RepoAccessViolation,
	},
) {}

export class RepoPushByNameMiddleware extends RpcMiddleware.Tag<RepoPushByNameMiddleware>()(
	"RepoPushByNameMiddleware",
	{
		provides: RepoPermissionContext,
		failure: RepoAccessViolation,
	},
) {}

export class RepoMaintainByNameMiddleware extends RpcMiddleware.Tag<RepoMaintainByNameMiddleware>()(
	"RepoMaintainByNameMiddleware",
	{
		provides: RepoPermissionContext,
		failure: RepoAccessViolation,
	},
) {}

export class RepoAdminByNameMiddleware extends RpcMiddleware.Tag<RepoAdminByNameMiddleware>()(
	"RepoAdminByNameMiddleware",
	{
		provides: RepoPermissionContext,
		failure: RepoAccessViolation,
	},
) {}

export const DatabaseSecurityMiddlewareImplementations: ReadonlyArray<MiddlewareImplementation> =
	[
		middleware(AdminTokenMiddleware, (options: MiddlewareOptions) =>
			authorizeAdminToken(options),
		),
		middleware(RequireAdminRoleMiddleware, (options: MiddlewareOptions) =>
			authorizeAdminRole(options),
		),
		middleware(RequireAuthenticatedMiddleware, (options: MiddlewareOptions) =>
			Effect.gen(function* () {
				const userId = yield* resolveIdentityUserId(options);
				if (userId === null) {
					return yield* Effect.die(
						new RepoAccessViolation({
							reason: "not_authenticated",
							message: "Authentication is required",
							repositoryId: null,
							ownerLogin: null,
							name: null,
							required: "pull",
							userId: null,
						}),
					);
				}
				return { userId };
			}),
		),
		middleware(ReadGitHubRepoByIdMiddleware, (options: MiddlewareOptions) =>
			authorizeReadRepoById(options),
		),
		middleware(ReadGitHubRepoByNameMiddleware, (options: MiddlewareOptions) =>
			authorizeReadRepoByName(options),
		),
		middleware(RepoPullByIdMiddleware, (options: MiddlewareOptions) =>
			authorizeRepoById(options, "pull", false),
		),
		middleware(RepoTriageByIdMiddleware, (options: MiddlewareOptions) =>
			authorizeRepoById(options, "triage", false),
		),
		middleware(RepoPushByIdMiddleware, (options: MiddlewareOptions) =>
			authorizeRepoById(options, "push", false),
		),
		middleware(RepoMaintainByIdMiddleware, (options: MiddlewareOptions) =>
			authorizeRepoById(options, "maintain", false),
		),
		middleware(RepoAdminByIdMiddleware, (options: MiddlewareOptions) =>
			authorizeRepoById(options, "admin", false),
		),
		middleware(RepoPullByNameMiddleware, (options: MiddlewareOptions) =>
			authorizeRepoByName(options, "pull", false),
		),
		middleware(RepoTriageByNameMiddleware, (options: MiddlewareOptions) =>
			authorizeRepoByName(options, "triage", false),
		),
		middleware(RepoPushByNameMiddleware, (options: MiddlewareOptions) =>
			authorizeRepoByName(options, "push", false),
		),
		middleware(RepoMaintainByNameMiddleware, (options: MiddlewareOptions) =>
			authorizeRepoByName(options, "maintain", false),
		),
		middleware(RepoAdminByNameMiddleware, (options: MiddlewareOptions) =>
			authorizeRepoByName(options, "admin", false),
		),
	];
