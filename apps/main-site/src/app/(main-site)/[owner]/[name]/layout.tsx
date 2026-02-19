import { Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { RepoLayoutClient } from "./layout-client";

export default async function RepoLayout(props: {
	children: React.ReactNode;
	params: Promise<{ owner: string; name: string }>;
}) {
	const params = await props.params;
	const { owner, name } = params;

	// Prefetch the repo overview so the header renders instantly
	const overviewPromise = serverQueries.getRepoOverview.queryPromise({
		ownerLogin: owner,
		name,
	});

	return (
		<Suspense>
			<RepoLayoutClient
				owner={owner}
				name={name}
				initialOverviewPromise={overviewPromise}
			>
				{props.children}
			</RepoLayoutClient>
		</Suspense>
	);
}
