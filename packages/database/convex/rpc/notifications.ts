/**
 * Notifications — GitHub notification polling + local caching.
 *
 * Endpoints:
 *   - listNotifications (query)   — list cached notifications for the signed-in user
 *   - syncNotifications (action)  — poll GitHub /notifications and upsert locally
 *   - markNotificationRead (mutation) — mark a notification read locally + schedule GitHub PATCH
 *   - upsertNotifications (internalMutation) — batch upsert notification records
 *   - markNotificationReadRemote (internalAction) — call GitHub API to mark thread as read
 */
import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Option, Schema } from "effect";
import { internal } from "../_generated/api";
import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	confectSchema,
} from "../confect";
import { GitHubApiClient } from "../shared/githubApi";
import { lookupGitHubTokenByUserIdConfect } from "../shared/githubToken";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const SubjectType = Schema.Literal(
	"Issue",
	"PullRequest",
	"Release",
	"Commit",
	"Discussion",
	"CheckSuite",
	"RepositoryVulnerabilityAlert",
	"RepositoryDependabotAlertsThread",
);

const Reason = Schema.Literal(
	"assign",
	"author",
	"ci_activity",
	"comment",
	"manual",
	"mention",
	"push",
	"review_requested",
	"security_alert",
	"state_change",
	"subscribed",
	"team_mention",
	"approval_requested",
);

const NotificationItem = Schema.Struct({
	githubNotificationId: Schema.String,
	repositoryFullName: Schema.String,
	repositoryId: Schema.NullOr(Schema.Number),
	subjectTitle: Schema.String,
	subjectType: SubjectType,
	subjectUrl: Schema.NullOr(Schema.String),
	reason: Reason,
	unread: Schema.Boolean,
	updatedAt: Schema.Number,
	lastReadAt: Schema.NullOr(Schema.Number),
	entityNumber: Schema.NullOr(Schema.Number),
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class NotAuthenticated extends Schema.TaggedError<NotAuthenticated>()(
	"NotAuthenticated",
	{ reason: Schema.String },
) {}

class NotificationNotFound extends Schema.TaggedError<NotificationNotFound>()(
	"NotificationNotFound",
	{ githubNotificationId: Schema.String },
) {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isoToMs = (v: string): number => {
	const ms = new Date(v).getTime();
	return Number.isNaN(ms) ? Date.now() : ms;
};

/**
 * Parse entity number from a GitHub notification subject URL.
 * e.g. "https://api.github.com/repos/owner/repo/issues/42" -> 42
 */
const parseEntityNumber = (url: string): number | null => {
	const match = url.match(/\/(\d+)$/);
	if (!match) return null;
	const n = Number(match[1]);
	return Number.isNaN(n) ? null : n;
};

type ValidSubjectType = Schema.Schema.Type<typeof SubjectType>;
type ValidReason = Schema.Schema.Type<typeof Reason>;

const SUBJECT_TYPE_MAP: Record<string, ValidSubjectType> = {
	Issue: "Issue",
	PullRequest: "PullRequest",
	Release: "Release",
	Commit: "Commit",
	Discussion: "Discussion",
	CheckSuite: "CheckSuite",
	RepositoryVulnerabilityAlert: "RepositoryVulnerabilityAlert",
	RepositoryDependabotAlertsThread: "RepositoryDependabotAlertsThread",
};

const REASON_MAP: Record<string, ValidReason> = {
	assign: "assign",
	author: "author",
	ci_activity: "ci_activity",
	comment: "comment",
	manual: "manual",
	mention: "mention",
	push: "push",
	review_requested: "review_requested",
	security_alert: "security_alert",
	state_change: "state_change",
	subscribed: "subscribed",
	team_mention: "team_mention",
	approval_requested: "approval_requested",
};

const toSubjectType = (s: string): ValidSubjectType =>
	SUBJECT_TYPE_MAP[s] ?? "Issue";

const toReason = (s: string): ValidReason => REASON_MAP[s] ?? "subscribed";

// ---------------------------------------------------------------------------
// Endpoint definitions
// ---------------------------------------------------------------------------

/**
 * List cached notifications for the signed-in user.
 */
const listNotificationsDef = factory.query({
	success: Schema.Array(NotificationItem),
});

/**
 * Poll GitHub's /notifications API and upsert locally.
 */
const syncNotificationsDef = factory.action({
	success: Schema.Struct({ syncedCount: Schema.Number }),
	error: NotAuthenticated,
});

/**
 * Mark a notification as read locally and schedule a remote PATCH.
 */
const markNotificationReadDef = factory.mutation({
	payload: {
		githubNotificationId: Schema.String,
	},
	success: Schema.Struct({ updated: Schema.Boolean }),
	error: Schema.Union(NotAuthenticated, NotificationNotFound),
});

/**
 * Internal: batch upsert notification records.
 */
const upsertNotificationsDef = factory.internalMutation({
	payload: {
		userId: Schema.String,
		notifications: Schema.Array(
			Schema.Struct({
				githubNotificationId: Schema.String,
				repositoryFullName: Schema.String,
				repositoryId: Schema.NullOr(Schema.Number),
				subjectTitle: Schema.String,
				subjectType: SubjectType,
				subjectUrl: Schema.NullOr(Schema.String),
				reason: Reason,
				unread: Schema.Boolean,
				updatedAt: Schema.Number,
				lastReadAt: Schema.NullOr(Schema.Number),
				entityNumber: Schema.NullOr(Schema.Number),
			}),
		),
	},
	success: Schema.Struct({ upsertedCount: Schema.Number }),
});

/**
 * Internal: call GitHub API to mark a notification thread as read.
 */
const markNotificationReadRemoteDef = factory.internalAction({
	payload: {
		actingUserId: Schema.String,
		githubNotificationId: Schema.String,
	},
	success: Schema.Struct({ success: Schema.Boolean }),
});

// ---------------------------------------------------------------------------
// Helper: resolve signed-in user ID from ctx
// ---------------------------------------------------------------------------

const getActingUserId = (ctx: {
	auth: {
		getUserIdentity: () => Effect.Effect<Option.Option<{ subject: string }>>;
	};
}): Effect.Effect<string, NotAuthenticated> =>
	Effect.gen(function* () {
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) {
			return yield* new NotAuthenticated({ reason: "User is not signed in" });
		}
		return identity.value.subject;
	});

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

listNotificationsDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) return [];

		const userId = identity.value.subject;

		const notifications = yield* ctx.db
			.query("github_notifications")
			.withIndex("by_userId_and_updatedAt", (q) => q.eq("userId", userId))
			.order("desc")
			.take(50);

		return notifications.map((n) => ({
			githubNotificationId: n.githubNotificationId,
			repositoryFullName: n.repositoryFullName,
			repositoryId: n.repositoryId,
			subjectTitle: n.subjectTitle,
			subjectType: n.subjectType,
			subjectUrl: n.subjectUrl,
			reason: n.reason,
			unread: n.unread,
			updatedAt: n.updatedAt,
			lastReadAt: n.lastReadAt,
			entityNumber: n.entityNumber,
		}));
	}),
);

syncNotificationsDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

		// Resolve the signed-in user's identity via internal query
		const identityResult = yield* ctx.runQuery(
			internal.rpc.notifications.getViewerUserId,
			{},
		);
		const IdentitySchema = Schema.Struct({
			userId: Schema.NullOr(Schema.String),
		});
		const identity = Schema.decodeUnknownSync(IdentitySchema)(identityResult);
		if (!identity.userId) {
			return yield* new NotAuthenticated({
				reason: "User is not signed in",
			});
		}
		const userId = identity.userId;

		// Resolve the GitHub token
		const token = yield* lookupGitHubTokenByUserIdConfect(
			ctx.runQuery,
			userId,
		).pipe(
			Effect.catchTag(
				"NoGitHubTokenError",
				(e) => new NotAuthenticated({ reason: e.reason }),
			),
		);
		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		// Fetch notifications from GitHub using typed client
		const threads = yield* gh.client
			.activityListNotificationsForAuthenticatedUser({
				all: false,
				per_page: 50,
			})
			.pipe(Effect.catchAll(() => Effect.succeed([])));

		// Map typed Thread objects to our notification shape
		const parsed = threads.map((n) => ({
			githubNotificationId: n.id,
			repositoryFullName: n.repository.full_name,
			repositoryId: n.repository.id,
			subjectTitle: n.subject.title,
			subjectType: toSubjectType(n.subject.type),
			subjectUrl: n.subject.url,
			reason: toReason(n.reason),
			unread: n.unread,
			updatedAt: isoToMs(n.updated_at),
			lastReadAt: n.last_read_at !== null ? isoToMs(n.last_read_at) : null,
			entityNumber: parseEntityNumber(n.subject.url),
		}));

		// Upsert via internal mutation
		yield* ctx.runMutation(internal.rpc.notifications.upsertNotifications, {
			userId,
			notifications: parsed,
		});

		return { syncedCount: parsed.length };
	}),
);

markNotificationReadDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		const userId = yield* getActingUserId(ctx);

		const existing = yield* ctx.db
			.query("github_notifications")
			.withIndex("by_userId_and_githubNotificationId", (q) =>
				q
					.eq("userId", userId)
					.eq("githubNotificationId", args.githubNotificationId),
			)
			.first();

		if (Option.isNone(existing)) {
			return yield* new NotificationNotFound({
				githubNotificationId: args.githubNotificationId,
			});
		}

		yield* ctx.db.patch(existing.value._id, {
			unread: false,
			lastReadAt: Date.now(),
		});

		// Schedule remote mark-as-read
		yield* Effect.promise(() =>
			ctx.scheduler.runAfter(
				0,
				internal.rpc.notifications.markNotificationReadRemote,
				{
					actingUserId: userId,
					githubNotificationId: args.githubNotificationId,
				},
			),
		);

		return { updated: true };
	}),
);

upsertNotificationsDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		let upsertedCount = 0;

		for (const notification of args.notifications) {
			const existing = yield* ctx.db
				.query("github_notifications")
				.withIndex("by_userId_and_githubNotificationId", (q) =>
					q
						.eq("userId", args.userId)
						.eq("githubNotificationId", notification.githubNotificationId),
				)
				.first();

			if (Option.isSome(existing)) {
				yield* ctx.db.patch(existing.value._id, {
					repositoryFullName: notification.repositoryFullName,
					repositoryId: notification.repositoryId,
					subjectTitle: notification.subjectTitle,
					subjectType: notification.subjectType,
					subjectUrl: notification.subjectUrl,
					reason: notification.reason,
					unread: notification.unread,
					updatedAt: notification.updatedAt,
					lastReadAt: notification.lastReadAt,
					entityNumber: notification.entityNumber,
				});
			} else {
				yield* ctx.db.insert("github_notifications", {
					userId: args.userId,
					githubNotificationId: notification.githubNotificationId,
					repositoryFullName: notification.repositoryFullName,
					repositoryId: notification.repositoryId,
					subjectTitle: notification.subjectTitle,
					subjectType: notification.subjectType,
					subjectUrl: notification.subjectUrl,
					reason: notification.reason,
					unread: notification.unread,
					updatedAt: notification.updatedAt,
					lastReadAt: notification.lastReadAt,
					entityNumber: notification.entityNumber,
				});
			}

			upsertedCount++;
		}

		return { upsertedCount };
	}),
);

markNotificationReadRemoteDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

		const token = yield* lookupGitHubTokenByUserIdConfect(
			ctx.runQuery,
			args.actingUserId,
		);
		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		yield* gh.client.activityMarkThreadAsRead(args.githubNotificationId);

		return { success: true };
	}).pipe(Effect.catchAll(() => Effect.succeed({ success: false }))),
);

// ---------------------------------------------------------------------------
// Internal query: resolve the signed-in user's ID (used by syncNotifications action)
// ---------------------------------------------------------------------------

const getViewerUserIdDef = factory.internalQuery({
	success: Schema.Struct({
		userId: Schema.NullOr(Schema.String),
	}),
});

getViewerUserIdDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const identity = yield* ctx.auth.getUserIdentity();
		if (Option.isNone(identity)) return { userId: null };
		return { userId: identity.value.subject };
	}),
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const notificationsModule = makeRpcModule(
	{
		listNotifications: listNotificationsDef,
		syncNotifications: syncNotificationsDef,
		markNotificationRead: markNotificationReadDef,
		upsertNotifications: upsertNotificationsDef,
		markNotificationReadRemote: markNotificationReadRemoteDef,
		getViewerUserId: getViewerUserIdDef,
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const {
	listNotifications,
	syncNotifications,
	markNotificationRead,
	upsertNotifications,
	markNotificationReadRemote,
	getViewerUserId,
} = notificationsModule.handlers;
export { notificationsModule };
export type NotificationsModule = typeof notificationsModule;
