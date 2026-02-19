import { Suspense } from "react";
import { cachedListWorkflowRuns } from "@/lib/server-queries";
import { ListSkeleton } from "../../../../_components/skeletons";
import { ActionsListClient } from "./actions-list-client";

export default function ActionsListSlot(props: {
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
