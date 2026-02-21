import {
	FileCode2,
	GitPullRequest,
	Play,
	TriangleAlert,
} from "@packages/ui/components/icons";
import { Link } from "@packages/ui/components/link";
import { cn } from "@packages/ui/lib/utils";
import { type ReactNode, Suspense } from "react";
import { ListSkeleton } from "./skeletons";

type RepoTab = "pulls" | "issues" | "actions" | "code";

/**
 * Tab bar + body content for repo detail sidebar pages.
 * Rendered inside the universal SidebarClient shell.
 */
export async function RepoListShell({
	paramsPromise,
	activeTab,
	children,
}: {
	paramsPromise: Promise<{ owner: string; name: string }>;
	activeTab: RepoTab;
	children: ReactNode;
}) {
	const { owner, name } = await paramsPromise;

	return (
		<>
			<div className="shrink-0 border-b border-sidebar-border">
				<div className="flex px-0.5 mt-0.5">
					<Link
						href={`/${owner}/${name}/pulls`}
						className={cn(
							"flex items-center gap-1 px-1.5 py-1 text-[10px] font-semibold border-b-2 -mb-px transition-colors no-underline",
							activeTab === "pulls"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
						aria-label="Pull requests"
					>
						<GitPullRequest className="size-2.5" />
						<span>PRs</span>
					</Link>
					<Link
						href={`/${owner}/${name}/issues`}
						className={cn(
							"flex items-center gap-1 px-1.5 py-1 text-[10px] font-semibold border-b-2 -mb-px transition-colors no-underline",
							activeTab === "issues"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
						aria-label="Issues"
					>
						<TriangleAlert className="size-2.5" />
						<span>Issues</span>
					</Link>
					<Link
						href={`/${owner}/${name}/actions`}
						className={cn(
							"flex items-center gap-1 px-1.5 py-1 text-[10px] font-semibold border-b-2 -mb-px transition-colors no-underline",
							activeTab === "actions"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
						aria-label="CI"
					>
						<Play className="size-2.5" />
						<span>CI</span>
					</Link>
					<Link
						href={`/${owner}/${name}/code`}
						className={cn(
							"flex items-center gap-1 px-1.5 py-1 text-[10px] font-semibold border-b-2 -mb-px transition-colors no-underline",
							activeTab === "code"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
						aria-label="Code"
					>
						<FileCode2 className="size-2.5" />
						<span>Code</span>
					</Link>
				</div>
			</div>
			<Suspense fallback={<ListSkeleton />}>{children}</Suspense>
		</>
	);
}
