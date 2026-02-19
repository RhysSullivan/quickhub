import { Suspense } from "react";
import { cachedListIssues } from "@/lib/server-queries";
import { ListSkeleton } from "../../../../_components/skeletons";
import { IssueListClient } from "./issue-list-client";

/**
 * Fallback for the @list slot when navigating directly to /issues/[number].
 * On soft navigation (clicking a list item), Next.js keeps the existing
 * rendered page.tsx — this default.tsx is only used for hard navigation.
 */
export default function IssueListDefault(props: {
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
