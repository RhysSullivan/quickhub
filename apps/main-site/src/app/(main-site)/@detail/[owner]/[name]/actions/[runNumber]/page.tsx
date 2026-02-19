import { serverQueries } from "@/lib/server-queries";
import { RunDetailClient } from "./run-detail-client";

export default async function RunDetailSlot(props: {
	params: Promise<{ owner: string; name: string; runNumber: string }>;
}) {
	const params = await props.params;
	const { owner, name } = params;
	const runNumber = Number.parseInt(params.runNumber, 10);

	const initialRun = await serverQueries.getWorkflowRunDetail.queryPromise({
		ownerLogin: owner,
		name,
		runNumber,
	});

	return (
		<RunDetailClient
			owner={owner}
			name={name}
			runNumber={runNumber}
			initialRun={initialRun}
		/>
	);
}
