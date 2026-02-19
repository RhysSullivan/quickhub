"use client";

import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import { Badge } from "@packages/ui/components/badge";
import { Link } from "@packages/ui/components/link";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import {
	CheckCircle2,
	Circle,
	GitPullRequest,
	Loader2,
	Play,
	TriangleAlert,
	XCircle,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

type WorkflowRunItem = {
	readonly githubRunId: number;
	readonly workflowName: string | null;
	readonly runNumber: number;
	readonly event: string;
	readonly status: string | null;
	readonly conclusion: string | null;
	readonly headBranch: string | null;
	readonly headSha: string;
	readonly actorLogin: string | null;
	readonly actorAvatarUrl: string | null;
	readonly jobCount: number;
	readonly htmlUrl: string | null;
	readonly createdAt: number;
	readonly updatedAt: number;
};

export function ActionsListClient({
	owner,
	name,
	initialData = [],
}: {
	owner: string;
	name: string;
	initialData?: readonly WorkflowRunItem[];
}) {
	const client = useProjectionQueries();
	const runsAtom = useMemo(
		() =>
			client.listWorkflowRuns.subscription({
				ownerLogin: owner,
				name,
			}),
		[client, owner, name],
	);

	const runs = useSubscriptionWithInitial(runsAtom, initialData);

	const pathname = usePathname();
	const activeRunNumber = (() => {
		const match = /\/actions\/(\d+)/.exec(pathname);
		return match?.[1] ? Number.parseInt(match[1], 10) : null;
	})();

	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 border-b">
				<div className="flex items-center justify-between px-3 pt-2 pb-0">
					<span className="text-sm font-semibold text-foreground truncate">
						{owner}/{name}
					</span>
				</div>
				<TabBar owner={owner} name={name} activeTab="actions" />
			</div>
			<div className="flex-1 overflow-y-auto">
				<div className="p-2">
					{runs.length === 0 && (
						<p className="px-2 py-6 text-xs text-muted-foreground text-center">
							No workflow runs.
						</p>
					)}

					{runs.map((run) => (
						<Link
							key={run.githubRunId}
							href={`/${owner}/${name}/actions/${run.runNumber}`}
							className={cn(
								"flex items-start gap-2 rounded-md px-2.5 py-2 text-sm transition-colors no-underline",
								activeRunNumber === run.runNumber
									? "bg-accent text-accent-foreground"
									: "hover:bg-muted",
							)}
						>
							<RunStatusIcon status={run.status} conclusion={run.conclusion} />
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									<span className="font-medium text-xs truncate">
										{run.workflowName ?? `Run #${run.runNumber}`}
									</span>
									{run.conclusion && (
										<ConclusionBadge conclusion={run.conclusion} />
									)}
								</div>
								<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
									<span>#{run.runNumber}</span>
									{run.headBranch && (
										<code className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">
											{run.headBranch}
										</code>
									)}
									<span>{run.event}</span>
									{run.actorLogin && <span>{run.actorLogin}</span>}
									<span>{formatRelative(run.updatedAt)}</span>
								</div>
							</div>
						</Link>
					))}
				</div>
			</div>
		</div>
	);
}

// --- Tab bar ---

function TabBar({
	owner,
	name,
	activeTab,
}: {
	owner: string;
	name: string;
	activeTab: "pulls" | "issues" | "actions";
}) {
	return (
		<div className="flex px-1 mt-1">
			<Link
				href={`/${owner}/${name}/pulls`}
				className={cn(
					"flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors no-underline",
					activeTab === "pulls"
						? "border-foreground text-foreground"
						: "border-transparent text-muted-foreground hover:text-foreground",
				)}
			>
				<GitPullRequest className="size-3.5" />
				PRs
			</Link>
			<Link
				href={`/${owner}/${name}/issues`}
				className={cn(
					"flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors no-underline",
					activeTab === "issues"
						? "border-foreground text-foreground"
						: "border-transparent text-muted-foreground hover:text-foreground",
				)}
			>
				<TriangleAlert className="size-3.5" />
				Issues
			</Link>
			<Link
				href={`/${owner}/${name}/actions`}
				className={cn(
					"flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors no-underline",
					activeTab === "actions"
						? "border-foreground text-foreground"
						: "border-transparent text-muted-foreground hover:text-foreground",
				)}
			>
				<Play className="size-3.5" />
				Actions
			</Link>
		</div>
	);
}

// --- Helpers ---

function RunStatusIcon({
	status,
	conclusion,
}: {
	status: string | null;
	conclusion: string | null;
}) {
	if (conclusion === "success")
		return <CheckCircle2 className="mt-0.5 size-3.5 text-green-600 shrink-0" />;
	if (conclusion === "failure")
		return <XCircle className="mt-0.5 size-3.5 text-red-600 shrink-0" />;
	if (status === "in_progress" || status === "queued")
		return (
			<Loader2 className="mt-0.5 size-3.5 text-yellow-500 shrink-0 animate-spin" />
		);
	return <Circle className="mt-0.5 size-3.5 text-muted-foreground shrink-0" />;
}

function ConclusionBadge({ conclusion }: { conclusion: string }) {
	const variant =
		conclusion === "success"
			? "secondary"
			: conclusion === "failure"
				? "destructive"
				: "outline";
	return (
		<Badge
			variant={variant}
			className={cn(
				"text-[9px] px-1 py-0",
				conclusion === "success" && "text-green-600",
			)}
		>
			{conclusion}
		</Badge>
	);
}

function formatRelative(timestamp: number): string {
	const diff = Math.floor((Date.now() - timestamp) / 1000);
	if (diff < 60) return "just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
	return new Date(timestamp).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
