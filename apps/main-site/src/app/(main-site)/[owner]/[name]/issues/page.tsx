import { Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { IssueListClient } from "./issues-client";

export default async function IssuesPage(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	const params = await props.params;
	const { owner, name } = params;

	// Prefetch the default view (open issues) — don't await, pass as promise
	const issuesPromise = serverQueries.listIssues.queryPromise({
		ownerLogin: owner,
		name,
		state: "open",
	});

	return (
		<Suspense>
			<IssueListClient
				owner={owner}
				name={name}
				initialDataPromise={issuesPromise}
			/>
		</Suspense>
	);
}
