import { Suspense } from "react";
import {
	cachedGetPullRequestDetail,
	cachedListPrFiles,
} from "@/lib/server-queries";
import { DetailSkeleton } from "../../../../../_components/skeletons";
import { PrDetailClient } from "./pr-detail-client";

export default function PrDetailSlot(props: {
	params: Promise<{ owner: string; name: string; number: string }>;
}) {
	return (
		<Suspense fallback={<DetailSkeleton />}>
			<PrDetailCached paramsPromise={props.params} />
		</Suspense>
	);
}

async function PrDetailCached({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string; number: string }>;
}) {
	const params = await paramsPromise;
	const { owner, name } = params;
	const num = Number.parseInt(params.number, 10);

	const [initialPr, initialFiles] = await Promise.all([
		cachedGetPullRequestDetail(owner, name, num),
		cachedListPrFiles(owner, name, num),
	]);

	return (
		<PrDetailClient
			owner={owner}
			name={name}
			prNumber={num}
			initialPr={initialPr}
			initialFiles={initialFiles}
		/>
	);
}
