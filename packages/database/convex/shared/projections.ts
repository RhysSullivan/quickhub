/**
 * Projection builders — update denormalized view tables from normalized domain data.
 *
 * Currently only the activity feed projection is maintained. The materialized
 * view tables (view_repo_overview, view_repo_pull_request_list, etc.) have been
 * removed in favour of querying normalized tables directly.
 */
import { Effect } from "effect";
import { ConfectMutationCtx } from "../confect";

// ---------------------------------------------------------------------------
// view_activity_feed — normalized activity events from webhook events
// ---------------------------------------------------------------------------

export const appendActivityFeedEntry = (
	repositoryId: number,
	installationId: number,
	activityType: string,
	title: string,
	description: string | null,
	actorLogin: string | null,
	actorAvatarUrl: string | null,
	entityNumber: number | null,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectMutationCtx;
		yield* ctx.db.insert("view_activity_feed", {
			repositoryId,
			installationId,
			activityType,
			title,
			description,
			actorLogin,
			actorAvatarUrl,
			entityNumber,
			createdAt: Date.now(),
		});
	});
