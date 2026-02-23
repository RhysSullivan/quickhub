import { Skeleton } from "@packages/ui/components/skeleton";
import { cacheLife } from "next/cache";
import { type ReactNode, Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { SyncProgressOverlay } from "../../_components/sync-progress-client";
import {
	RecentIssuesPanel,
	RecentPrsPanel,
	RepoOverviewHeader,
} from "./repo-overview-client";

/**
 * Repo overview page (/:owner/:name).
 *
 * Entry resolves params and builds dynamic slots. The cached shell serves
 * the layout instantly; each data section streams in via Suspense.
 */
export default function RepoPage({
	params,
}: {
	params: Promise<{ owner: string; name: string }>;
}) {
	return <RepoDetailEntry paramsPromise={params} />;
}

async function RepoDetailEntry({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string }>;
}) {
	const { owner, name } = await paramsPromise;

	return (
		<RepoDetailShell
			owner={owner}
			name={name}
			header={
				<Suspense fallback={<OverviewHeaderSkeleton />}>
					<RepoOverviewHeaderContent owner={owner} name={name} />
				</Suspense>
			}
			prs={
				<Suspense fallback={<PrsSkeleton />}>
					<RecentPrsContent owner={owner} name={name} />
				</Suspense>
			}
			issues={
				<Suspense fallback={<IssuesSkeleton />}>
					<RecentIssuesContent owner={owner} name={name} />
				</Suspense>
			}
		/>
	);
}

async function RepoDetailShell({
	owner,
	name,
	header,
	prs,
	issues,
}: {
	owner: string;
	name: string;
	header: ReactNode;
	prs: ReactNode;
	issues: ReactNode;
}) {
	"use cache";
	cacheLife("max");

	return (
		<SyncProgressOverlay owner={owner} name={name}>
			<div className="h-full overflow-y-auto">
				<div className="px-6 py-8">
					<div key="header">{header}</div>
					<div key="prs">{prs}</div>
					<div key="issues">{issues}</div>
				</div>
			</div>
		</SyncProgressOverlay>
	);
}

async function RepoOverviewHeaderContent({
	owner,
	name,
}: {
	owner: string;
	name: string;
}) {
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
