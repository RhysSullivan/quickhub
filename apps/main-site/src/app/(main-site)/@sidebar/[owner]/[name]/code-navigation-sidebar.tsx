import { Suspense } from "react";
import { RepoListShell } from "../../../_components/repo-list-shell";
import { ListSkeleton } from "../../../_components/skeletons";
import { FileTreeClient } from "./code/file-tree-client";

export function CodeNavigationSidebar(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	return (
		<RepoListShell paramsPromise={props.params} activeTab="code">
			<Suspense fallback={<ListSkeleton />}>
				<FileTreeContent paramsPromise={props.params} />
			</Suspense>
		</RepoListShell>
	);
}

async function FileTreeContent({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string }>;
}) {
	const { owner, name } = await paramsPromise;
	return <FileTreeClient owner={owner} name={name} />;
}
