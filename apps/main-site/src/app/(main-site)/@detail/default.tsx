import { connection } from "next/server";
import { Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { DashboardSkeleton, HomeDashboard } from "./home-dashboard-client";

export default function DetailDefault() {
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
