import { serverQueries } from "@/lib/server-queries";
import { PrDetailClient } from "./pr-detail-client";

export default async function PrDetailSlot(props: {
	params: Promise<{ owner: string; name: string; number: string }>;
}) {
	const params = await props.params;
	const { owner, name } = params;
	const num = Number.parseInt(params.number, 10);

	// Await both in parallel — no Suspense so the server fully renders before
	// sending the response. Next.js keeps the previous detail visible until ready.
	const [initialPr, initialFiles] = await Promise.all([
		serverQueries.getPullRequestDetail.queryPromise({
			ownerLogin: owner,
			name,
			number: num,
		}),
		serverQueries.listPrFiles.queryPromise({
			ownerLogin: owner,
			name,
			number: num,
		}),
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
