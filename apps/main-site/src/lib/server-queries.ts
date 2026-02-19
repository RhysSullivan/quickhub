import "server-only";

import { createServerRpcQuery } from "@packages/confect/rpc";
import { api } from "@packages/database/convex/_generated/api";
import type { ProjectionQueriesModule } from "@packages/database/convex/rpc/projectionQueries";
import { cacheLife, cacheTag } from "next/cache";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export const serverQueries = createServerRpcQuery<ProjectionQueriesModule>(
	api.rpc.projectionQueries,
	{ url: CONVEX_URL },
);

// ---------------------------------------------------------------------------
// Cached wrappers — `use cache` generates keys from function arguments.
// Short TTL because the Convex real-time subscription on the client takes
// over immediately; the cache only exists for instant initial paint.
// ---------------------------------------------------------------------------

export async function cachedListPullRequests(
	ownerLogin: string,
	name: string,
	state: "open" | "closed",
) {
	"use cache";
	cacheLife("minutes");
	cacheTag(`pr-list-${ownerLogin}-${name}`);

	return serverQueries.listPullRequests.queryPromise({
		ownerLogin,
		name,
		state,
	});
}

export async function cachedListIssues(
	ownerLogin: string,
	name: string,
	state: "open" | "closed",
) {
	"use cache";
	cacheLife("minutes");
	cacheTag(`issue-list-${ownerLogin}-${name}`);

	return serverQueries.listIssues.queryPromise({
		ownerLogin,
		name,
		state,
	});
}

export async function cachedListWorkflowRuns(ownerLogin: string, name: string) {
	"use cache";
	cacheLife("minutes");
	cacheTag(`actions-list-${ownerLogin}-${name}`);

	return serverQueries.listWorkflowRuns.queryPromise({
		ownerLogin,
		name,
	});
}

export async function cachedGetPullRequestDetail(
	ownerLogin: string,
	name: string,
	number: number,
) {
	"use cache";
	cacheLife("minutes");
	cacheTag(`pr-detail-${ownerLogin}-${name}-${number}`);

	return serverQueries.getPullRequestDetail.queryPromise({
		ownerLogin,
		name,
		number,
	});
}

export async function cachedListPrFiles(
	ownerLogin: string,
	name: string,
	number: number,
) {
	"use cache";
	cacheLife("minutes");
	cacheTag(`pr-files-${ownerLogin}-${name}-${number}`);

	return serverQueries.listPrFiles.queryPromise({
		ownerLogin,
		name,
		number,
	});
}

export async function cachedGetIssueDetail(
	ownerLogin: string,
	name: string,
	number: number,
) {
	"use cache";
	cacheLife("minutes");
	cacheTag(`issue-detail-${ownerLogin}-${name}-${number}`);

	return serverQueries.getIssueDetail.queryPromise({
		ownerLogin,
		name,
		number,
	});
}

export async function cachedGetWorkflowRunDetail(
	ownerLogin: string,
	name: string,
	runNumber: number,
) {
	"use cache";
	cacheLife("minutes");
	cacheTag(`run-detail-${ownerLogin}-${name}-${runNumber}`);

	return serverQueries.getWorkflowRunDetail.queryPromise({
		ownerLogin,
		name,
		runNumber,
	});
}
