import { api } from "@packages/database/convex/_generated/api";
import { Suspense } from "react";
import { fetchAuthMutation } from "@/lib/auth-server";
import { serverQueries } from "@/lib/server-queries";
import { PrDetailSkeleton } from "../../../../../_components/skeletons";
import { PrDetailClient } from "./pr-detail-client";

export default function PrDetailSlot(props: {
	params: Promise<{ owner: string; name: string; number: string }>;
}) {
	return (
		<Suspense fallback={<PrDetailSkeleton />}>
			<PrDetailContent paramsPromise={props.params} />
		</Suspense>
	);
}

async function PrDetailContent({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string; number: string }>;
}) {
	const params = await paramsPromise;
	const { owner, name } = params;
	const num = Number.parseInt(params.number, 10);

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

	if (initialPr !== null && initialFiles.files.length === 0) {
		await fetchAuthMutation(api.rpc.projectionQueries.requestPrFileSync, {
			ownerLogin: owner,
			name,
			number: num,
		}).catch(() => null);
	}

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
