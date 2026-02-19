import { Suspense } from "react";
import { cachedListIssues } from "@/lib/server-queries";
import { ListSkeleton } from "../../../../_components/skeletons";
import { IssueListClient } from "./issue-list-client";

export default function IssueListSlot(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	return (
		<Suspense fallback={<ListSkeleton />}>
			<IssueListCached paramsPromise={props.params} />
		</Suspense>
	);
}

async function IssueListCached({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string }>;
}) {
	const { owner, name } = await paramsPromise;

	const initialData = await cachedListIssues(owner, name, "open");

	return (
		<IssueListClient owner={owner} name={name} initialData={initialData} />
	);
}
