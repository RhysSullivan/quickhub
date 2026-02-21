import {
	FileCode2,
	GitPullRequest,
	Play,
	TriangleAlert,
} from "@packages/ui/components/icons";
import { Link } from "@packages/ui/components/link";
import { cn } from "@packages/ui/lib/utils";
import { type ReactNode, Suspense } from "react";
import { serverQueries } from "@/lib/server-queries";
import { RepoNavSelector } from "./repo-nav-selector";
import { ListSkeleton } from "./skeletons";

type RepoTab = "pulls" | "issues" | "actions" | "code";

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
	const [overview, initialRepos] = await Promise.all([
		serverQueries.getRepoOverview.queryPromise({
			ownerLogin: owner,
			name,
		}),
		serverQueries.listRepos.queryPromise({}),
	]);

	return (
		<div className="flex h-full flex-col bg-sidebar">
			<div className="shrink-0 border-b border-sidebar-border">
				<RepoNavSelector
					owner={owner}
					name={name}
					activeTab={activeTab}
					initialRepos={initialRepos}
				/>
				<div className="flex px-0.5 mt-0.5">
					<Link
						href={`/${owner}/${name}/pulls`}
						className={cn(
							"flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-semibold border-b-2 -mb-px transition-colors no-underline",
							activeTab === "pulls"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<GitPullRequest className="size-2.5" />
						PRs
					</Link>
					<Link
						href={`/${owner}/${name}/issues`}
						className={cn(
							"flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-semibold border-b-2 -mb-px transition-colors no-underline",
							activeTab === "issues"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<TriangleAlert className="size-2.5" />
						Issues
					</Link>
					<Link
						href={`/${owner}/${name}/actions`}
						className={cn(
							"flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-semibold border-b-2 -mb-px transition-colors no-underline",
							activeTab === "actions"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<Play className="size-2.5" />
						CI
					</Link>
					<Link
						href={`/${owner}/${name}/code`}
						className={cn(
							"flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-semibold border-b-2 -mb-px transition-colors no-underline",
							activeTab === "code"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<FileCode2 className="size-2.5" />
						Code
					</Link>
				</div>
				{overview !== null && (
					<div className="flex items-center gap-1.5 px-2 pb-1 pt-0.5 text-[9px] text-muted-foreground/50 tabular-nums">
						<span>{overview.openPrCount} PRs</span>
						<span className="text-muted-foreground/30">&middot;</span>
						<span>{overview.openIssueCount} issues</span>
						{overview.failingCheckCount > 0 && (
							<>
								<span className="text-muted-foreground/30">&middot;</span>
								<span className="text-destructive/70 font-medium">
									{overview.failingCheckCount} failing
								</span>
							</>
						)}
					</div>
				)}
			</div>
			<div className="flex-1 overflow-y-auto">
				<Suspense fallback={<ListSkeleton />}>{children}</Suspense>
			</div>
		</div>
	);
}
