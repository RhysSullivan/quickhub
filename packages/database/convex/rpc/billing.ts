import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { internal } from "../_generated/api";
import {
	AUTUMN_ORG_SEAT_FEATURE_ID,
	AUTUMN_ORG_SEAT_PRODUCT_ID,
	createOrgAutumn,
	isAutumnConfigured,
} from "../autumn";
import { ConfectActionCtx, ConfectQueryCtx, confectSchema } from "../confect";
import { GitHubApiClient } from "../shared/githubApi";
import { getInstallationToken } from "../shared/githubApp";
import { DatabaseRpcModuleMiddlewares } from "./moduleMiddlewares";
import { AuthenticatedUser, RequireAuthenticatedMiddleware } from "./security";

const factory = createRpcFactory({ schema: confectSchema });
const FREE_ORG_STAR_THRESHOLD = 1000;
const PERMISSION_QUERY_CONCURRENCY_LIMIT = 12;

const OwnerSeatSnapshot = Schema.Struct({
	ownerLogin: Schema.String,
	installationId: Schema.Number,
	isOrganization: Schema.Boolean,
	seatCount: Schema.Number,
	hasHighStarRepo: Schema.Boolean,
	reposMissingStarCount: Schema.Array(Schema.String),
	viewerCanManage: Schema.Boolean,
});

const OwnerBillingStatus = Schema.Struct({
	ownerLogin: Schema.String,
	isOrganization: Schema.Boolean,
	seatCount: Schema.Number,
	viewerCanManage: Schema.Boolean,
	billingConfigured: Schema.Boolean,
	hasAccess: Schema.Boolean,
	requiresCheckout: Schema.Boolean,
	freeByHighStarRepo: Schema.Boolean,
});

class BillingAccessDenied extends Schema.TaggedError<BillingAccessDenied>()(
	"BillingAccessDenied",
	{
		ownerLogin: Schema.String,
	},
) {}

const ownerHasPermission = (row: {
	pull: boolean;
	triage: boolean;
	push: boolean;
	maintain: boolean;
	admin: boolean;
}) => row.pull || row.triage || row.push || row.maintain || row.admin;

const isRepoAboveFreeThreshold = (stargazersCount: number | undefined) =>
	typeof stargazersCount === "number" &&
	stargazersCount > FREE_ORG_STAR_THRESHOLD;

const getOwnerSeatSnapshotDef = factory.internalQuery({
	payload: {
		ownerLogin: Schema.String,
		viewerUserId: Schema.String,
	},
	success: OwnerSeatSnapshot,
});

const getOwnerSeatBillingStatusDef = factory
	.action({
		payload: {
			ownerLogin: Schema.String,
		},
		success: OwnerBillingStatus,
	})
	.middleware(RequireAuthenticatedMiddleware);

const startOwnerSeatCheckoutDef = factory
	.action({
		payload: {
			ownerLogin: Schema.String,
			successUrl: Schema.optional(Schema.String),
		},
		success: Schema.Struct({
			checkoutUrl: Schema.NullOr(Schema.String),
			seatCount: Schema.Number,
		}),
		error: BillingAccessDenied,
	})
	.middleware(RequireAuthenticatedMiddleware);

const openOwnerBillingPortalDef = factory
	.action({
		payload: {
			ownerLogin: Schema.String,
			returnUrl: Schema.optional(Schema.String),
		},
		success: Schema.Struct({
			url: Schema.NullOr(Schema.String),
		}),
		error: BillingAccessDenied,
	})
	.middleware(RequireAuthenticatedMiddleware);

const redactedBillingStatus = (ownerLogin: string) => ({
	ownerLogin,
	isOrganization: false,
	seatCount: 0,
	viewerCanManage: false,
	billingConfigured: isAutumnConfigured,
	hasAccess: true,
	requiresCheckout: false,
	freeByHighStarRepo: false,
});

getOwnerSeatSnapshotDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		const repos = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_ownerLogin_and_name", (q) =>
				q.eq("ownerLogin", args.ownerLogin),
			)
			.collect();

		if (repos.length === 0) {
			return {
				ownerLogin: args.ownerLogin,
				installationId: 0,
				isOrganization: false,
				seatCount: 0,
				hasHighStarRepo: false,
				reposMissingStarCount: [],
				viewerCanManage: false,
			};
		}

		const installation = yield* ctx.db
			.query("github_installations")
			.withIndex("by_accountLogin", (q) =>
				q.eq("accountLogin", args.ownerLogin),
			)
			.first();

		const isOrganization =
			Option.isSome(installation) &&
			installation.value.accountType === "Organization";
		const installationId = Option.isSome(installation)
			? installation.value.installationId
			: 0;

		const hasHighStarRepo = repos.some((repo) =>
			isRepoAboveFreeThreshold(repo.stargazersCount),
		);
		const reposMissingStarCount = repos
			.filter((repo) => repo.stargazersCount === undefined)
			.map((repo) => repo.name);

		const ownerRepoIds = new Set(repos.map((repo) => repo.githubRepoId));

		const viewerPermissions = yield* ctx.db
			.query("github_user_repo_permissions")
			.withIndex("by_userId", (q) => q.eq("userId", args.viewerUserId))
			.collect();

		const viewerCanManage = viewerPermissions.some(
			(permission) =>
				ownerRepoIds.has(permission.repositoryId) && permission.admin,
		);

		const seatUserIds = new Set<string>();
		const permissionsByRepo = yield* Effect.forEach(
			repos,
			(repo) =>
				ctx.db
					.query("github_user_repo_permissions")
					.withIndex("by_repositoryId", (q) =>
						q.eq("repositoryId", repo.githubRepoId),
					)
					.collect(),
			{ concurrency: PERMISSION_QUERY_CONCURRENCY_LIMIT },
		);

		for (const permissions of permissionsByRepo) {
			for (const permission of permissions) {
				if (!ownerHasPermission(permission)) continue;
				seatUserIds.add(permission.userId);
			}
		}

		return {
			ownerLogin: args.ownerLogin,
			installationId,
			isOrganization,
			seatCount: seatUserIds.size,
			hasHighStarRepo,
			reposMissingStarCount,
			viewerCanManage,
		};
	}),
);

const checkMissingStarRepos = (
	ownerLogin: string,
	repoNames: ReadonlyArray<string>,
	installationId: number,
) =>
	Effect.gen(function* () {
		if (installationId <= 0 || repoNames.length === 0) {
			return false;
		}

		const token = yield* getInstallationToken(installationId).pipe(
			Effect.catchAll(() => Effect.succeed(null)),
		);
		if (token === null) {
			return false;
		}

		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		for (const repoName of repoNames) {
			const repo = yield* gh.client
				.reposGet(ownerLogin, repoName)
				.pipe(Effect.catchAll(() => Effect.succeed(null)));
			if (
				repo !== null &&
				typeof repo === "object" &&
				"stargazers_count" in repo &&
				typeof repo.stargazers_count === "number" &&
				repo.stargazers_count > FREE_ORG_STAR_THRESHOLD
			) {
				return true;
			}
		}

		return false;
	});

getOwnerSeatBillingStatusDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const { userId } = yield* AuthenticatedUser;

		const snapshotRaw = yield* ctx.runQuery(
			internal.rpc.billing.getOwnerSeatSnapshot,
			{
				ownerLogin: args.ownerLogin,
				viewerUserId: userId,
			},
		);
		const snapshot = Schema.decodeUnknownSync(OwnerSeatSnapshot)(snapshotRaw);

		if (!snapshot.isOrganization || !snapshot.viewerCanManage) {
			return redactedBillingStatus(args.ownerLogin);
		}

		const hasHighStarRepo =
			snapshot.hasHighStarRepo ||
			(yield* checkMissingStarRepos(
				args.ownerLogin,
				snapshot.reposMissingStarCount,
				snapshot.installationId,
			));

		if (hasHighStarRepo) {
			return {
				ownerLogin: snapshot.ownerLogin,
				isOrganization: snapshot.isOrganization,
				seatCount: snapshot.seatCount,
				viewerCanManage: snapshot.viewerCanManage,
				billingConfigured: isAutumnConfigured,
				hasAccess: true,
				requiresCheckout: false,
				freeByHighStarRepo: true,
			};
		}

		if (!isAutumnConfigured) {
			return {
				ownerLogin: snapshot.ownerLogin,
				isOrganization: snapshot.isOrganization,
				seatCount: snapshot.seatCount,
				viewerCanManage: snapshot.viewerCanManage,
				billingConfigured: false,
				hasAccess: true,
				requiresCheckout: false,
				freeByHighStarRepo: false,
			};
		}

		const autumn = createOrgAutumn(args.ownerLogin);
		const requiredBalance = snapshot.seatCount < 1 ? 1 : snapshot.seatCount;

		const result = yield* Effect.promise(() =>
			autumn.check(ctx, {
				featureId: AUTUMN_ORG_SEAT_FEATURE_ID,
				requiredBalance,
				withPreview: true,
			}),
		);

		const hasAccess = result.data !== null ? result.data.allowed : true;

		return {
			ownerLogin: snapshot.ownerLogin,
			isOrganization: snapshot.isOrganization,
			seatCount: snapshot.seatCount,
			viewerCanManage: snapshot.viewerCanManage,
			billingConfigured: true,
			hasAccess,
			requiresCheckout: !hasAccess,
			freeByHighStarRepo: false,
		};
	}),
);

startOwnerSeatCheckoutDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const { userId } = yield* AuthenticatedUser;

		if (!isAutumnConfigured) {
			return { checkoutUrl: null, seatCount: 0 };
		}

		const snapshotRaw = yield* ctx.runQuery(
			internal.rpc.billing.getOwnerSeatSnapshot,
			{
				ownerLogin: args.ownerLogin,
				viewerUserId: userId,
			},
		);
		const snapshot = Schema.decodeUnknownSync(OwnerSeatSnapshot)(snapshotRaw);

		if (!snapshot.isOrganization || !snapshot.viewerCanManage) {
			return yield* new BillingAccessDenied({ ownerLogin: args.ownerLogin });
		}

		const hasHighStarRepo =
			snapshot.hasHighStarRepo ||
			(yield* checkMissingStarRepos(
				args.ownerLogin,
				snapshot.reposMissingStarCount,
				snapshot.installationId,
			));

		if (hasHighStarRepo) {
			return { checkoutUrl: null, seatCount: snapshot.seatCount };
		}

		const autumn = createOrgAutumn(args.ownerLogin);
		const quantity = snapshot.seatCount < 1 ? 1 : snapshot.seatCount;

		const result = yield* Effect.promise(() =>
			autumn.checkout(ctx, {
				productId: AUTUMN_ORG_SEAT_PRODUCT_ID,
				successUrl: args.successUrl,
				options: [
					{
						featureId: AUTUMN_ORG_SEAT_FEATURE_ID,
						quantity,
					},
				],
			}),
		);

		const checkoutUrl = result.data?.url ?? null;
		return {
			checkoutUrl,
			seatCount: snapshot.seatCount,
		};
	}),
);

openOwnerBillingPortalDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;
		const { userId } = yield* AuthenticatedUser;

		if (!isAutumnConfigured) {
			return { url: null };
		}

		const snapshotRaw = yield* ctx.runQuery(
			internal.rpc.billing.getOwnerSeatSnapshot,
			{
				ownerLogin: args.ownerLogin,
				viewerUserId: userId,
			},
		);
		const snapshot = Schema.decodeUnknownSync(OwnerSeatSnapshot)(snapshotRaw);

		if (!snapshot.isOrganization || !snapshot.viewerCanManage) {
			return yield* new BillingAccessDenied({ ownerLogin: args.ownerLogin });
		}

		const autumn = createOrgAutumn(args.ownerLogin);
		const result = yield* Effect.promise(() =>
			autumn.customers.billingPortal(ctx, {
				returnUrl: args.returnUrl,
			}),
		);

		return { url: result.data?.url ?? null };
	}),
);

const billingModule = makeRpcModule(
	{
		getOwnerSeatSnapshot: getOwnerSeatSnapshotDef,
		getOwnerSeatBillingStatus: getOwnerSeatBillingStatusDef,
		startOwnerSeatCheckout: startOwnerSeatCheckoutDef,
		openOwnerBillingPortal: openOwnerBillingPortalDef,
	},
	{ middlewares: DatabaseRpcModuleMiddlewares },
);

export const {
	getOwnerSeatSnapshot,
	getOwnerSeatBillingStatus,
	startOwnerSeatCheckout,
	openOwnerBillingPortal,
} = billingModule.handlers;
export { billingModule };
export type BillingModule = typeof billingModule;
export { BillingAccessDenied };
