import { connection } from "next/server";
import { Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { DashboardSkeleton, HomeDashboard } from "../home-dashboard-client";

/**
 * Detail panel for the org overview page (/:owner).
 * Shows the home dashboard (scoped to this org by the backend).
 */
export default function OrgDetailDefault(props: {
	params: Promise<{ owner: string }>;
}) {
	return (
		<Suspense fallback={<DashboardSkeleton />}>
			<OrgDashboardContent paramsPromise={props.params} />
		</Suspense>
	);
}

async function OrgDashboardContent({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string }>;
}) {
	await connection();
	const { owner } = await paramsPromise;
	const initialDashboardPromise = serverQueries.getHomeDashboard.queryPromise({
		ownerLogin: owner,
	});
	return (
		<HomeDashboard
			initialDashboardPromise={initialDashboardPromise}
			query={{ ownerLogin: owner }}
		/>
	);
}
