import { Skeleton } from "@packages/ui/components/skeleton";
import { connection } from "next/server";
import { Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { SyncProgressOverlay } from "../../../_components/sync-progress-client";
import {
	RecentIssuesPanel,
	RecentPrsPanel,
	RepoOverviewHeader,
} from "./repo-overview-client";

/**
 * Detail panel for the repo overview page (/:owner/:name).
 * Sync parent renders immediately; the async child resolves params
 * inside Suspense so the server can flush the outer shell first.
 */
export default function RepoDetailDefault({
	params,
}: {
	params: Promise<{ owner: string; name: string }>;
}) {
	return (
		<Suspense fallback={<RepoOverviewSkeleton />}>
			<RepoDetailContent paramsPromise={params} />
		</Suspense>
	);
}

async function RepoDetailContent({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string }>;
}) {
	const { owner, name } = await paramsPromise;

	return (
		<SyncProgressOverlay owner={owner} name={name}>
			<div className="h-full overflow-y-auto">
				<div className="px-6 py-8">
					<Suspense fallback={<OverviewHeaderSkeleton />}>
						<RepoOverviewHeaderContent owner={owner} name={name} />
					</Suspense>
					<Suspense fallback={<PrsSkeleton />}>
						<RecentPrsContent owner={owner} name={name} />
					</Suspense>
					<Suspense fallback={<IssuesSkeleton />}>
						<RecentIssuesContent owner={owner} name={name} />
					</Suspense>
				</div>
			</div>
		</SyncProgressOverlay>
	);
}

// ---------------------------------------------------------------------------
// Async server components — each fetches its own data (deduped by confect)
// ---------------------------------------------------------------------------

async function RepoOverviewHeaderContent({
	owner,
	name,
}: {
	owner: string;
	name: string;
}) {
	await connection();
	const initialOverview = await serverQueries.getRepoOverview
		.queryPromise({ ownerLogin: owner, name })
		.catch(() => null);
	return (
		<RepoOverviewHeader
			owner={owner}
			name={name}
			initialOverview={initialOverview}
		/>
	);
}

async function RecentPrsContent({
	owner,
	name,
}: {
	owner: string;
	name: string;
}) {
	await connection();
	const initialPrs = await serverQueries.listPullRequests
		.queryPromise({ ownerLogin: owner, name, state: "open" })
		.catch(() => []);
	return <RecentPrsPanel owner={owner} name={name} initialPrs={initialPrs} />;
}

async function RecentIssuesContent({
	owner,
	name,
}: {
	owner: string;
	name: string;
}) {
	await connection();
	const initialIssues = await serverQueries.listIssues
		.queryPromise({ ownerLogin: owner, name, state: "open" })
		.catch(() => []);
	return (
		<RecentIssuesPanel
			owner={owner}
			name={name}
			initialIssues={initialIssues}
		/>
	);
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function RepoOverviewSkeleton() {
	return (
		<div className="h-full overflow-y-auto">
			<div className="px-6 py-8">
				<OverviewHeaderSkeleton />
				<PrsSkeleton />
				<IssuesSkeleton />
			</div>
		</div>
	);
}

function OverviewHeaderSkeleton() {
	return (
		<>
			<div className="mb-6">
				<Skeleton className="h-6 w-48 mb-1" />
				<Skeleton className="h-3 w-32" />
			</div>
			<div className="grid grid-cols-2 gap-3 mb-6">
				<Skeleton className="h-16 rounded-lg" />
				<Skeleton className="h-16 rounded-lg" />
			</div>
		</>
	);
}

function PrsSkeleton() {
	return (
		<div className="mb-6">
			<Skeleton className="h-4 w-32 mb-2" />
			<div className="space-y-2">
				<Skeleton className="h-12 rounded-lg" />
				<Skeleton className="h-12 rounded-lg" />
				<Skeleton className="h-12 rounded-lg" />
			</div>
		</div>
	);
}

function IssuesSkeleton() {
	return (
		<div className="mb-6">
			<Skeleton className="h-4 w-28 mb-2" />
			<div className="space-y-2">
				<Skeleton className="h-12 rounded-lg" />
				<Skeleton className="h-12 rounded-lg" />
			</div>
		</div>
	);
}
