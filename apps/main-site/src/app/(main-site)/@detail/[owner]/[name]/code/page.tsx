import { FileViewer } from "./file-viewer";

export default async function CodeDetailPage({
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
