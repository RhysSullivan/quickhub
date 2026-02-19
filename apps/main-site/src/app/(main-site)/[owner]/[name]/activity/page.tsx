import { Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { ActivityFeedClient } from "./activity-client";

export default async function ActivityPage(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	const params = await props.params;
	const { owner, name } = params;

	// Prefetch activity feed — don't await, pass as promise
	const activityPromise = serverQueries.listActivity.queryPromise({
		ownerLogin: owner,
		name,
		limit: 50,
	});

	return (
		<Suspense>
			<ActivityFeedClient
				owner={owner}
				name={name}
				initialDataPromise={activityPromise}
			/>
		</Suspense>
	);
}
