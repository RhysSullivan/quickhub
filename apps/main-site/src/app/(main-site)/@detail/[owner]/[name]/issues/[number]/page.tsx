import { Suspense } from "react";
import { cachedGetIssueDetail } from "@/lib/server-queries";
import { DetailSkeleton } from "../../../../../_components/skeletons";
import { IssueDetailClient } from "./issue-detail-client";

export default function IssueDetailSlot(props: {
	params: Promise<{ owner: string; name: string; number: string }>;
}) {
	return (
		<Suspense fallback={<DetailSkeleton />}>
			<IssueDetailCached paramsPromise={props.params} />
		</Suspense>
	);
}

async function IssueDetailCached({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string; number: string }>;
}) {
	const params = await paramsPromise;
	const { owner, name } = params;
	const num = Number.parseInt(params.number, 10);

	const initialIssue = await cachedGetIssueDetail(owner, name, num);

	return (
		<IssueDetailClient
			owner={owner}
			name={name}
			issueNumber={num}
			initialIssue={initialIssue}
		/>
	);
}
