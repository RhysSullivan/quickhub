import { Suspense } from "react";
import { RepoListSkeleton } from "../../../../../sidebar-repo-list";
import { CodeNavigationSidebar } from "../../../code-navigation-sidebar";

export default function BlobSidebarPage(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	return (
		<Suspense fallback={<RepoListSkeleton />}>
			<CodeNavigationSidebar params={props.params} />
		</Suspense>
	);
}
