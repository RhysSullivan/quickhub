"use client";

import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import { Link } from "@packages/ui/components/link";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import {
	CheckCircle2,
	CircleDot,
	GitPullRequest,
	MessageCircle,
	Play,
	TriangleAlert,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

type IssueItem = {
	readonly number: number;
	readonly state: "open" | "closed";
	readonly title: string;
	readonly authorLogin: string | null;
	readonly authorAvatarUrl: string | null;
	readonly labelNames: readonly string[];
	readonly commentCount: number;
	readonly githubUpdatedAt: number;
};

export function IssueListClient({
	owner,
	name,
	initialData = [],
}: {
	owner: string;
	name: string;
	initialData?: readonly IssueItem[];
}) {
	const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">(
		"open",
	);

	const client = useProjectionQueries();
	const issuesAtom = useMemo(
		() =>
			client.listIssues.subscription({
				ownerLogin: owner,
				name,
				state: stateFilter === "all" ? undefined : stateFilter,
			}),
		[client, owner, name, stateFilter],
	);

	const issues = useSubscriptionWithInitial(issuesAtom, initialData);

	const pathname = usePathname();
	const activeNumber = (() => {
		const match = /\/issues\/(\d+)/.exec(pathname);
		return match?.[1] ? Number.parseInt(match[1], 10) : null;
	})();

	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 border-b">
				<div className="flex items-center justify-between px-3 pt-2 pb-0">
					<span className="text-xs font-bold text-foreground truncate tracking-tight">
						{owner}
						<span className="text-muted-foreground/40 mx-0.5">/</span>
						{name}
					</span>
				</div>
				<TabBar owner={owner} name={name} activeTab="issues" />
			</div>
			<div className="flex-1 overflow-y-auto">
				<div className="p-1.5">
					<div className="flex gap-0.5 mb-1.5 px-1">
						{(["open", "closed", "all"] as const).map((f) => (
							<Button
								key={f}
								variant={stateFilter === f ? "default" : "ghost"}
								size="sm"
								className="h-6 text-[10px] px-2 font-medium"
								onClick={() => setStateFilter(f)}
							>
								{f === "open" ? "Open" : f === "closed" ? "Closed" : "All"}
							</Button>
						))}
					</div>

					{issues.length === 0 && (
						<p className="px-2 py-8 text-xs text-muted-foreground text-center">
							No {stateFilter !== "all" ? stateFilter : ""} issues.
						</p>
					)}

					{issues.map((issue) => (
						<Link
							key={issue.number}
							href={`/${owner}/${name}/issues/${issue.number}`}
							className={cn(
								"flex items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors no-underline",
								activeNumber === issue.number
									? "bg-accent text-accent-foreground"
									: "hover:bg-accent/50",
							)}
						>
							<IssueStateIcon state={issue.state} />
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									<span className="font-medium text-xs truncate leading-tight">
										{issue.title}
									</span>
								</div>
								<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5 tabular-nums">
									<span>#{issue.number}</span>
									{issue.authorLogin && (
										<>
											<span className="text-muted-foreground/40">&middot;</span>
											<span>{issue.authorLogin}</span>
										</>
									)}
									<span className="text-muted-foreground/40">&middot;</span>
									<span>{formatRelative(issue.githubUpdatedAt)}</span>
									{issue.commentCount > 0 && (
										<span className="flex items-center gap-0.5">
											<MessageCircle className="size-2.5" />
											{issue.commentCount}
										</span>
									)}
								</div>
								{issue.labelNames.length > 0 && (
									<div className="flex flex-wrap gap-0.5 mt-1">
										{issue.labelNames.map((label) => (
											<Badge
												key={label}
												variant="outline"
												className="text-[9px] px-1 py-0"
											>
												{label}
											</Badge>
										))}
									</div>
								)}
							</div>
						</Link>
					))}
				</div>
			</div>
		</div>
	);
}

// --- Tab bar shared between list panels ---

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
					"flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold border-b-2 -mb-px transition-colors no-underline",
					activeTab === "pulls"
						? "border-foreground text-foreground"
						: "border-transparent text-muted-foreground hover:text-foreground",
				)}
			>
				<GitPullRequest className="size-3" />
				PRs
			</Link>
			<Link
				href={`/${owner}/${name}/issues`}
				className={cn(
					"flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold border-b-2 -mb-px transition-colors no-underline",
					activeTab === "issues"
						? "border-foreground text-foreground"
						: "border-transparent text-muted-foreground hover:text-foreground",
				)}
			>
				<TriangleAlert className="size-3" />
				Issues
			</Link>
			<Link
				href={`/${owner}/${name}/actions`}
				className={cn(
					"flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold border-b-2 -mb-px transition-colors no-underline",
					activeTab === "actions"
						? "border-foreground text-foreground"
						: "border-transparent text-muted-foreground hover:text-foreground",
				)}
			>
				<Play className="size-3" />
				Actions
			</Link>
		</div>
	);
}

// --- Small helpers ---

function IssueStateIcon({ state }: { state: "open" | "closed" }) {
	if (state === "open")
		return <CircleDot className="mt-0.5 size-3.5 text-green-600 shrink-0" />;
	return <CheckCircle2 className="mt-0.5 size-3.5 text-purple-600 shrink-0" />;
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
