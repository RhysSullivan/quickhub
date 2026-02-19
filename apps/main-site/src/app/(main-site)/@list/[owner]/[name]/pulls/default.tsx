import { Suspense } from "react";
import { cachedListPullRequests } from "@/lib/server-queries";
import { ListSkeleton } from "../../../../_components/skeletons";
import { PrListClient } from "./pr-list-client";

/**
 * Fallback for the @list slot when navigating directly to /pulls/[number].
 * On soft navigation (clicking a list item), Next.js keeps the existing
 * rendered page.tsx — this default.tsx is only used for hard navigation.
 */
export default function PrListDefault(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	return (
		<Suspense fallback={<ListSkeleton />}>
			<PrListCached paramsPromise={props.params} />
		</Suspense>
	);
}

async function PrListCached({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string }>;
}) {
	const { owner, name } = await paramsPromise;

	const initialData = await cachedListPullRequests(owner, name, "open");

	return <PrListClient owner={owner} name={name} initialData={initialData} />;
}
