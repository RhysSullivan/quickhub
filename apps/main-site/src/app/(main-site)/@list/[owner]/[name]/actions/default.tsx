import { Suspense } from "react";
import { cachedListWorkflowRuns } from "@/lib/server-queries";
import { ListSkeleton } from "../../../../_components/skeletons";
import { ActionsListClient } from "./actions-list-client";

/**
 * Fallback for the @list slot when navigating directly to /actions/[runNumber].
 * On soft navigation (clicking a list item), Next.js keeps the existing
 * rendered page.tsx — this default.tsx is only used for hard navigation.
 */
export default function ActionsListDefault(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	return (
		<Suspense fallback={<ListSkeleton />}>
			<ActionsListCached paramsPromise={props.params} />
		</Suspense>
	);
}

async function ActionsListCached({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string }>;
}) {
	const { owner, name } = await paramsPromise;

	const initialData = await cachedListWorkflowRuns(owner, name);

	return (
		<ActionsListClient owner={owner} name={name} initialData={initialData} />
	);
}
