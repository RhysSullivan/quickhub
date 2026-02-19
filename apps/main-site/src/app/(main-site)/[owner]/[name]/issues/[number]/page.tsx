import { Link } from "@packages/ui/components/link";
import { Skeleton } from "@packages/ui/components/skeleton";
import { Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { IssueDetailClient } from "./issue-detail-client";

// ---------------------------------------------------------------------------
// Server component — fetches initial data, wraps client in Suspense
// ---------------------------------------------------------------------------

export default async function IssueDetailPage(props: {
	params: Promise<{ owner: string; name: string; number: string }>;
}) {
	const params = await props.params;
	const { owner, name } = params;
	const issueNumber = parseInt(params.number, 10);

	// Start fetching — pass promise to client for Suspense
	const issuePromise = serverQueries.getIssueDetail.queryPromise({
		ownerLogin: owner,
		name,
		number: issueNumber,
	});

	return (
		<div className="max-w-4xl">
			<div className="mb-6">
				<Link
					href={`/${owner}/${name}/issues`}
					className="text-sm text-muted-foreground hover:text-foreground"
				>
					&larr; Issues
				</Link>
			</div>

			<Suspense fallback={<DetailSkeleton />}>
				<IssueDetailClient
					owner={owner}
					name={name}
					issueNumber={issueNumber}
					initialDataPromise={issuePromise}
				/>
			</Suspense>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Skeleton (server-rendered)
// ---------------------------------------------------------------------------

function DetailSkeleton() {
	return (
		<div>
			<Skeleton className="h-8 w-3/4" />
			<Skeleton className="mt-3 h-5 w-1/2" />
			<Skeleton className="mt-6 h-40 w-full" />
			<Skeleton className="mt-8 h-6 w-32" />
			<div className="mt-4 space-y-4">
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		</div>
	);
}
