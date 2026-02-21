import { connection } from "next/server";
import { Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { DashboardSkeleton, HomeDashboard } from "./home-dashboard-client";

/**
 * Root page for the @detail slot — shows the personalized dashboard at "/".
 * This must exist as a page.tsx (not just default.tsx) so that navigating
 * back to "/" from a nested route properly resolves the parallel route
 * instead of showing a stale detail panel.
 */
export default function DetailSlot() {
	return (
		<Suspense fallback={<DashboardSkeleton />}>
			<HomeDashboardContent />
		</Suspense>
	);
}

async function HomeDashboardContent() {
	await connection();
	const initialDashboardPromise = serverQueries.getHomeDashboard.queryPromise(
		{},
	);
	return (
		<HomeDashboard
			initialDashboardPromise={initialDashboardPromise}
			query={{}}
		/>
	);
}
