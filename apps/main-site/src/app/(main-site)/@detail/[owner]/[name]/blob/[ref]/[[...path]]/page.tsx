import { Skeleton } from "@packages/ui/components/skeleton";
import { Suspense } from "react";
import { FileViewer } from "../../../code/file-viewer";

export default async function BlobDetailPage({
	params,
}: {
	params: Promise<{
		owner: string;
		name: string;
		ref: string;
		path?: string[];
	}>;
}) {
	const { owner, name, ref, path } = await params;
	const filePath = path === undefined ? null : path.join("/");

	return (
		<Suspense fallback={<FileViewerSkeleton />}>
			<FileViewer owner={owner} name={name} path={filePath} refName={ref} />
		</Suspense>
	);
}

function FileViewerSkeleton() {
	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center gap-2 border-b px-3 py-2">
				<Skeleton className="size-3 rounded" />
				<Skeleton className="h-3 w-40" />
				<div className="ml-auto">
					<Skeleton className="h-3 w-16" />
				</div>
			</div>
			<div className="flex-1 p-3 space-y-1.5">
				<Skeleton className="h-3 w-3/4" />
				<Skeleton className="h-3 w-1/2" />
				<Skeleton className="h-3 w-5/6" />
				<Skeleton className="h-3 w-2/3" />
				<Skeleton className="h-3 w-4/5" />
				<Skeleton className="h-3 w-1/3" />
				<Skeleton className="h-3 w-3/4" />
				<Skeleton className="h-3 w-1/2" />
				<Skeleton className="h-3 w-5/6" />
				<Skeleton className="h-3 w-2/5" />
			</div>
		</div>
	);
}
