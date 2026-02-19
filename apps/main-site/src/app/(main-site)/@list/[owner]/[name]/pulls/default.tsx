import { serverQueries } from "@/lib/server-queries";
import { PrListClient } from "./pr-list-client";

/**
 * Fallback for the @list slot when navigating directly to /pulls/[number].
 * On soft navigation (clicking a list item), Next.js keeps the existing
 * rendered page.tsx — this default.tsx is only used for hard navigation.
 */
export default async function PrListDefault(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	const { owner, name } = await props.params;

	const initialData = await serverQueries.listPullRequests.queryPromise({
		ownerLogin: owner,
		name,
		state: "open",
	});

	return <PrListClient owner={owner} name={name} initialData={initialData} />;
}
