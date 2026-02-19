import { Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { PullRequestListClient } from "./pulls-client";

export default async function PullRequestsPage(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	const params = await props.params;
	const { owner, name } = params;

	// Prefetch the default view (open PRs) — don't await, pass as promise
	const prsPromise = serverQueries.listPullRequests.queryPromise({
		ownerLogin: owner,
		name,
		state: "open",
	});

	return (
		<Suspense>
			<PullRequestListClient
				owner={owner}
				name={name}
				initialDataPromise={prsPromise}
			/>
		</Suspense>
	);
}
