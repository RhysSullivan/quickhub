import { serverQueries } from "@/lib/server-queries";
import { ActionsListClient } from "./actions-list-client";

/**
 * Fallback for the @list slot when navigating directly to /actions/[runNumber].
 * On soft navigation (clicking a list item), Next.js keeps the existing
 * rendered page.tsx — this default.tsx is only used for hard navigation.
 */
export default async function ActionsListDefault(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	const { owner, name } = await props.params;

	const initialData = await serverQueries.listWorkflowRuns.queryPromise({
		ownerLogin: owner,
		name,
	});

	return (
		<ActionsListClient owner={owner} name={name} initialData={initialData} />
	);
}
