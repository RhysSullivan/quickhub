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
import { Effect, Either, Option, Schema } from "effect";
import { internal } from "../_generated/api";
import {
	ConfectActionCtx,
	ConfectMutationCtx,
	ConfectQueryCtx,
	confectSchema,
} from "../confect";
import type { Thread } from "../shared/generated_github_client";
import { GitHubApiClient } from "../shared/githubApi";
import { lookupTokenByProviderConfect } from "../shared/githubToken";
import { parseIsoToMsOrNow as isoToMs } from "../shared/time";
import { DatabaseRpcModuleMiddlewares } from "./moduleMiddlewares";
import { AuthenticatedUser, RequireAuthenticatedMiddleware } from "./security";

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

class GitHubSyncFailed extends Schema.TaggedError<GitHubSyncFailed>()(
	"GitHubSyncFailed",
	{ reason: Schema.String },
) {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const GitHubErrorCauseSchema = Schema.Struct({
	message: Schema.optional(Schema.String),
	status: Schema.optional(Schema.Number),
	documentation_url: Schema.optional(Schema.String),
});

const GitHubErrorResponseSchema = Schema.Struct({
	status: Schema.Number,
});

const GitHubErrorSummarySchema = Schema.Struct({
	_tag: Schema.optional(Schema.String),
	cause: Schema.optional(GitHubErrorCauseSchema),
	response: Schema.optional(GitHubErrorResponseSchema),
});

const decodeGitHubErrorSummary = Schema.decodeUnknownEither(
	GitHubErrorSummarySchema,
);

/** Extract a human-readable message from a GitHub API error. */
const formatGitHubError = (error: object): string => {
	const decoded = decodeGitHubErrorSummary(error);
	if (Either.isLeft(decoded)) {
		return `Unknown error: ${JSON.stringify(error)}`;
	}

	const tag = decoded.right._tag ?? "Unknown";
	const cause = decoded.right.cause;
	const causeMsg =
		cause?.message ??
		(cause?.status !== undefined ? `status=${String(cause.status)}` : null);
	const status =
		decoded.right.response?.status !== undefined
			? String(decoded.right.response.status)
			: null;
	const detail = [
		tag,
		status ? `HTTP ${status}` : null,
		causeMsg,
		cause?.documentation_url ?? null,
	]
		.filter(Boolean)
		.join(": ");
	return detail || `Unknown error: ${JSON.stringify(error)}`;
};

// ---------------------------------------------------------------------------
// Endpoint definitions
// ---------------------------------------------------------------------------

/**
 * List cached notifications for the signed-in user.
 */
const listNotificationsDef = factory
	.query({
		success: Schema.Array(NotificationItem),
	})
	.middleware(RequireAuthenticatedMiddleware);

/**
 * Poll GitHub's /notifications API and upsert locally.
 */
const syncNotificationsDef = factory
	.action({
		success: Schema.Struct({ syncedCount: Schema.Number }),
		error: Schema.Union(NotAuthenticated, GitHubSyncFailed),
	})
	.middleware(RequireAuthenticatedMiddleware);

/**
 * Mark a notification as read locally and schedule a remote PATCH.
 */
const markNotificationReadDef = factory
	.mutation({
		payload: {
			githubNotificationId: Schema.String,
		},
		success: Schema.Struct({ updated: Schema.Boolean }),
		error: Schema.Union(NotAuthenticated, NotificationNotFound),
	})
	.middleware(RequireAuthenticatedMiddleware);

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
// Implementations
// ---------------------------------------------------------------------------

listNotificationsDef.implement(() =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const { userId } = yield* AuthenticatedUser;

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
		const { userId } = yield* AuthenticatedUser;

		// Resolve the classic OAuth token for notifications
		// GitHub App tokens (ghu_) can't access /notifications — need a
		// classic OAuth token from the "github-notifications" provider.
		const token = yield* lookupTokenByProviderConfect(
			(query, params) => ctx.runQuery(query, params),
			(mutation, params) => ctx.runMutation(mutation, params),
			"github-notifications",
			userId,
		).pipe(
			Effect.catchTag(
				"NoGitHubTokenError",
				() =>
					new NotAuthenticated({
						reason:
							"GitHub notifications access not connected. Please connect your GitHub account for notifications.",
					}),
			),
		);

		const gh = yield* Effect.provide(
			GitHubApiClient,
			GitHubApiClient.fromToken(token),
		);

		// Fetch all notification pages from GitHub
		const PAGE_SIZE = 50;
		const MAX_PAGES = 10; // safety cap: 500 notifications max
		const allThreads: Array<Thread> = [];

		for (let page = 1; page <= MAX_PAGES; page++) {
			const threads = yield* gh.client
				.activityListNotificationsForAuthenticatedUser({
					all: false,
					per_page: PAGE_SIZE,
					page,
				})
				.pipe(
					Effect.catchAll(
						(error) =>
							new GitHubSyncFailed({
								reason: formatGitHubError(error),
							}),
					),
				);

			allThreads.push(...threads);

			// If we got fewer than PAGE_SIZE, there are no more pages
			if (threads.length < PAGE_SIZE) break;
		}

		// Map typed Thread objects to our notification shape
		const parsed = allThreads.map((n) => {
			const subjectUrl = n.subject.url ?? null;
			return {
				githubNotificationId: n.id,
				repositoryFullName: n.repository.full_name,
				repositoryId: n.repository.id,
				subjectTitle: n.subject.title,
				subjectType: toSubjectType(n.subject.type),
				subjectUrl,
				reason: toReason(n.reason),
				unread: n.unread,
				updatedAt: isoToMs(n.updated_at),
				lastReadAt: n.last_read_at !== null ? isoToMs(n.last_read_at) : null,
				entityNumber:
					subjectUrl !== null ? parseEntityNumber(subjectUrl) : null,
			};
		});

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
		const { userId } = yield* AuthenticatedUser;

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

		// Mark stale notifications as read: if GitHub no longer returns them
		// with `all: false`, they've been read/dismissed externally.
		const syncedIds = new Set(
			args.notifications.map((n) => n.githubNotificationId),
		);
		const allLocal = yield* ctx.db
			.query("github_notifications")
			.withIndex("by_userId_and_unread", (q) =>
				q.eq("userId", args.userId).eq("unread", true),
			)
			.collect();
		for (const local of allLocal) {
			if (!syncedIds.has(local.githubNotificationId)) {
				yield* ctx.db.patch(local._id, {
					unread: false,
					lastReadAt: Date.now(),
				});
			}
		}

		return { upsertedCount };
	}),
);

markNotificationReadRemoteDef.implement((args) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectActionCtx;

		const token = yield* lookupTokenByProviderConfect(
			(query, params) => ctx.runQuery(query, params),
			(mutation, params) => ctx.runMutation(mutation, params),
			"github-notifications",
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
// Module
// ---------------------------------------------------------------------------

const notificationsModule = makeRpcModule(
	{
		listNotifications: listNotificationsDef,
		syncNotifications: syncNotificationsDef,
		markNotificationRead: markNotificationReadDef,
		upsertNotifications: upsertNotificationsDef,
		markNotificationReadRemote: markNotificationReadRemoteDef,
	},
	{ middlewares: DatabaseRpcModuleMiddlewares },
);

export const {
	listNotifications,
	syncNotifications,
	markNotificationRead,
	upsertNotifications,
	markNotificationReadRemote,
} = notificationsModule.handlers;
export { notificationsModule };
export type NotificationsModule = typeof notificationsModule;
