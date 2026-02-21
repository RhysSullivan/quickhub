import { FileViewer } from "./file-viewer";

/**
 * Fallback for the @detail slot when navigating to /code without a path.
 */
export default async function CodeDetailDefault({
	params,
	searchParams,
}: {
	params: Promise<{ owner: string; name: string }>;
	searchParams: Promise<{ path?: string; treeSha?: string }>;
}) {
	const { owner, name } = await params;
	const { path, treeSha } = await searchParams;
	return (
		<FileViewer
			owner={owner}
			name={name}
			path={path ?? null}
			treeSha={treeSha ?? null}
		/>
	);
}
