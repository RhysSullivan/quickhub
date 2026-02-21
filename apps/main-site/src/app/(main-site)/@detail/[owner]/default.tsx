import { Skeleton } from "@packages/ui/components/skeleton";
import { connection } from "next/server";
import { Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import type { DashboardData } from "../home-dashboard-client";
import {
	AttentionBannerClient,
	CommandPaletteClient,
	IssuesColumnClient,
	PrColumnClient,
	ReposColumnClient,
	SignInCta,
} from "../home-dashboard-client";

/**
 * Detail panel for the org overview page (/:owner).
 * Sync parent renders immediately; async child resolves params inside Suspense.
 */
export default function OrgDetailDefault(props: {
	params: Promise<{ owner: string }>;
}) {
	return (
		<Suspense fallback={<OrgDashboardSkeleton />}>
			<OrgDetailContent paramsPromise={props.params} />
		</Suspense>
	);
}

async function OrgDetailContent({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string }>;
}) {
	const { owner } = await paramsPromise;

	return (
		<div className="h-full overflow-y-auto bg-dotgrid">
			<div className="mx-auto max-w-[1600px] px-4 py-4 md:px-6 md:py-5">
				{/* Command palette */}
				<div className="mb-4">
					<Suspense fallback={<Skeleton className="h-10 w-full rounded-lg" />}>
						<OrgCommandPaletteSection owner={owner} />
					</Suspense>
				</div>

				{/* Sign-in CTA — renders nothing if signed in */}
				<SignInCta />

				{/* Attention banner — CI failures */}
				<Suspense>
					<OrgAttentionBannerSection owner={owner} />
				</Suspense>

				{/* Three-column grid */}
				<div className="grid gap-4 lg:grid-cols-3">
					<Suspense fallback={<ColumnSkeleton />}>
						<OrgPrColumnSection owner={owner} />
					</Suspense>
					<Suspense fallback={<ColumnSkeleton />}>
						<OrgIssuesColumnSection owner={owner} />
					</Suspense>
					<Suspense fallback={<ColumnSkeleton />}>
						<OrgReposColumnSection owner={owner} />
					</Suspense>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Async server components — each fetches the same (deduped) query
// ---------------------------------------------------------------------------

async function fetchOrgDashboard(owner: string): Promise<DashboardData> {
	await connection();
	return serverQueries.getHomeDashboard.queryPromise({ ownerLogin: owner });
}

async function OrgCommandPaletteSection({ owner }: { owner: string }) {
	const data = await fetchOrgDashboard(owner);
	return (
		<CommandPaletteClient initialData={data} query={{ ownerLogin: owner }} />
	);
}

async function OrgAttentionBannerSection({ owner }: { owner: string }) {
	const data = await fetchOrgDashboard(owner);
	return (
		<AttentionBannerClient initialData={data} query={{ ownerLogin: owner }} />
	);
}

async function OrgPrColumnSection({ owner }: { owner: string }) {
	const data = await fetchOrgDashboard(owner);
	return <PrColumnClient initialData={data} query={{ ownerLogin: owner }} />;
}

async function OrgIssuesColumnSection({ owner }: { owner: string }) {
	const data = await fetchOrgDashboard(owner);
	return (
		<IssuesColumnClient initialData={data} query={{ ownerLogin: owner }} />
	);
}

async function OrgReposColumnSection({ owner }: { owner: string }) {
	const data = await fetchOrgDashboard(owner);
	return <ReposColumnClient initialData={data} query={{ ownerLogin: owner }} />;
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function OrgDashboardSkeleton() {
	return (
		<div className="h-full overflow-y-auto bg-dotgrid">
			<div className="mx-auto max-w-[1600px] px-4 py-4 md:px-6 md:py-5">
				<div className="mb-4">
					<Skeleton className="h-10 w-full rounded-lg" />
				</div>
				<div className="grid gap-4 lg:grid-cols-3">
					<ColumnSkeleton />
					<ColumnSkeleton />
					<ColumnSkeleton />
				</div>
			</div>
		</div>
	);
}

function ColumnSkeleton() {
	return (
		<div className="space-y-0">
			<Skeleton className="mb-1.5 h-4 w-28" />
			<Skeleton className="h-72 rounded-lg" />
		</div>
	);
}
