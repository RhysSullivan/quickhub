"use client";

import {
	GitPullRequest,
	Play,
	TriangleAlert,
} from "@packages/ui/components/icons";
import { Link } from "@packages/ui/components/link";
import { cn } from "@packages/ui/lib/utils";

type RepoTab = "pulls" | "issues" | "actions";

/**
 * Client-side tab bar for repo sidebar pages.
 * Replaces the server-rendered `RepoListShell` — reads owner/name
 * directly as props derived from the URL by the parent.
 */
export function RepoTabBar({
	owner,
	name,
	activeTab,
}: {
	owner: string;
	name: string;
	activeTab: RepoTab;
}) {
	return (
		<div className="shrink-0 border-b border-sidebar-border">
			<div className="flex px-1 mt-0.5">
				<Link
					href={`/${owner}/${name}/pulls`}
					className={cn(
						"flex h-6 items-center gap-1 px-2 text-[10px] font-medium border-b-2 -mb-px transition-colors no-underline",
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
						"flex h-6 items-center gap-1 px-2 text-[10px] font-medium border-b-2 -mb-px transition-colors no-underline",
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
						"flex h-6 items-center gap-1 px-2 text-[10px] font-medium border-b-2 -mb-px transition-colors no-underline",
						activeTab === "actions"
							? "border-foreground text-foreground"
							: "border-transparent text-muted-foreground hover:text-foreground",
					)}
					aria-label="CI"
				>
					<Play className="size-2.5" />
					<span>CI</span>
				</Link>
				{/* Code tab hidden — re-enable when code browsing is ready */}
			</div>
		</div>
	);
}
