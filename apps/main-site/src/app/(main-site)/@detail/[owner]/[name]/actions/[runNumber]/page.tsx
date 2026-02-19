import { Suspense } from "react";
import { cachedGetWorkflowRunDetail } from "@/lib/server-queries";
import { DetailSkeleton } from "../../../../../_components/skeletons";
import { RunDetailClient } from "./run-detail-client";

export default function RunDetailSlot(props: {
	params: Promise<{ owner: string; name: string; runNumber: string }>;
}) {
	return (
		<Suspense fallback={<DetailSkeleton />}>
			<RunDetailCached paramsPromise={props.params} />
		</Suspense>
	);
}

async function RunDetailCached({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string; runNumber: string }>;
}) {
	const params = await paramsPromise;
	const { owner, name } = params;
	const runNumber = Number.parseInt(params.runNumber, 10);

	const initialRun = await cachedGetWorkflowRunDetail(owner, name, runNumber);

	return (
		<RunDetailClient
			owner={owner}
			name={name}
			runNumber={runNumber}
			initialRun={initialRun}
		/>
	);
}
