"use client";

import { Result, useAtomValue } from "@effect-atom/atom-react";
import { Badge } from "@packages/ui/components/badge";
import {
	ArrowRight,
	CircleDot,
	GitPullRequest,
	MessageCircle,
} from "@packages/ui/components/icons";
import { Link } from "@packages/ui/components/link";
import { Skeleton } from "@packages/ui/components/skeleton";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { Option } from "effect";
import { useMemo } from "react";

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

export function RepoOverviewPanel({
	owner,
	name,
}: {
	owner: string;
	name: string;
}) {
	const client = useProjectionQueries();

	const overviewAtom = useMemo(
		() =>
			client.getRepoOverview.subscription({
				ownerLogin: owner,
				name,
			}),
		[client, owner, name],
	);
	const overviewResult = useAtomValue(overviewAtom);

	const prsAtom = useMemo(
		() =>
			client.listPullRequests.subscription({
				ownerLogin: owner,
				name,
				state: "open",
			}),
		[client, owner, name],
	);
	const prsResult = useAtomValue(prsAtom);

	const issuesAtom = useMemo(
		() =>
			client.listIssues.subscription({
				ownerLogin: owner,
				name,
				state: "open",
			}),
		[client, owner, name],
	);
	const issuesResult = useAtomValue(issuesAtom);

	const overview = (() => {
		const v = Result.value(overviewResult);
		if (Option.isSome(v)) return v.value;
		return null;
	})();

	const prs = (() => {
		const v = Result.value(prsResult);
		if (Option.isSome(v)) return v.value;
		return null;
	})();

	const issues = (() => {
		const v = Result.value(issuesResult);
		if (Option.isSome(v)) return v.value;
		return null;
	})();

	if (Result.isInitial(overviewResult)) {
		return (
			<div className="h-full overflow-y-auto">
				<div className="px-6 py-8">
					<Skeleton className="h-6 w-48 mb-1" />
					<Skeleton className="h-3 w-32 mb-6" />
					<div className="grid grid-cols-2 gap-3 mb-6">
						<Skeleton className="h-16 rounded-lg" />
						<Skeleton className="h-16 rounded-lg" />
					</div>
					<div className="space-y-2">
						<Skeleton className="h-12 rounded-lg" />
						<Skeleton className="h-12 rounded-lg" />
						<Skeleton className="h-12 rounded-lg" />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="px-6 py-8">
				{/* Repo header */}
				<div className="mb-6">
					<h1 className="text-lg font-bold tracking-tight text-foreground">
						{owner}/{name}
					</h1>
					{overview?.lastPushAt && (
						<p className="text-[11px] text-muted-foreground mt-0.5">
							Last pushed {formatRelative(overview.lastPushAt)}
						</p>
					)}
				</div>

				{/* Quick stats */}
				{overview && (
					<div className="grid grid-cols-2 gap-3 mb-6">
						<Link
							href={`/${owner}/${name}/pulls`}
							className="rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted no-underline group"
						>
							<div className="flex items-center gap-1.5 mb-1">
								<GitPullRequest className="size-3 text-green-500" />
								<span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
									PRs
								</span>
							</div>
							<p className="text-xl font-bold tabular-nums text-foreground">
								{overview.openPrCount}
							</p>
						</Link>
						<Link
							href={`/${owner}/${name}/issues`}
							className="rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted no-underline group"
						>
							<div className="flex items-center gap-1.5 mb-1">
								<CircleDot className="size-3 text-blue-500" />
								<span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
									Issues
								</span>
							</div>
							<p className="text-xl font-bold tabular-nums text-foreground">
								{overview.openIssueCount}
							</p>
						</Link>
					</div>
				)}

				{/* Recent open PRs */}
				{prs !== null && prs.length > 0 && (
					<div className="mb-6">
						<div className="flex items-center justify-between mb-2">
							<div className="flex items-center gap-1.5">
								<GitPullRequest className="size-3.5 text-green-500" />
								<h2 className="text-xs font-semibold text-foreground">
									Open Pull Requests
								</h2>
							</div>
							<Link
								href={`/${owner}/${name}/pulls`}
								className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground no-underline transition-colors"
							>
								View all
								<ArrowRight className="size-2.5" />
							</Link>
						</div>
						<div className="divide-y rounded-lg border">
							{prs.slice(0, 5).map((pr) => (
								<Link
									key={pr.number}
									href={`/${owner}/${name}/pulls/${pr.number}`}
									className="flex items-start gap-2 px-3 py-2 transition-colors hover:bg-muted no-underline"
								>
									<PrStateIcon state={pr.state} draft={pr.draft} />
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5">
											<span className="font-medium text-xs truncate text-foreground">
												{pr.title}
											</span>
											{pr.draft && (
												<Badge
													variant="outline"
													className="text-[9px] px-1 py-0 shrink-0"
												>
													Draft
												</Badge>
											)}
										</div>
										<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
											<span>#{pr.number}</span>
											{pr.authorLogin && <span>{pr.authorLogin}</span>}
											<span>{formatRelative(pr.githubUpdatedAt)}</span>
											{pr.commentCount > 0 && (
												<span className="flex items-center gap-0.5">
													<MessageCircle className="size-2.5" />
													{pr.commentCount}
												</span>
											)}
										</div>
									</div>
									{pr.lastCheckConclusion && (
										<CheckDot conclusion={pr.lastCheckConclusion} />
									)}
								</Link>
							))}
						</div>
					</div>
				)}

				{/* Recent open issues */}
				{issues !== null && issues.length > 0 && (
					<div className="mb-6">
						<div className="flex items-center justify-between mb-2">
							<div className="flex items-center gap-1.5">
								<CircleDot className="size-3.5 text-blue-500" />
								<h2 className="text-xs font-semibold text-foreground">
									Open Issues
								</h2>
							</div>
							<Link
								href={`/${owner}/${name}/issues`}
								className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground no-underline transition-colors"
							>
								View all
								<ArrowRight className="size-2.5" />
							</Link>
						</div>
						<div className="divide-y rounded-lg border">
							{issues.slice(0, 5).map((issue) => (
								<Link
									key={issue.number}
									href={`/${owner}/${name}/issues/${issue.number}`}
									className="flex items-start gap-2 px-3 py-2 transition-colors hover:bg-muted no-underline"
								>
									<IssueStateIcon state={issue.state} />
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5">
											<span className="font-medium text-xs truncate text-foreground">
												{issue.title}
											</span>
										</div>
										<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
											<span>#{issue.number}</span>
											{issue.authorLogin && <span>{issue.authorLogin}</span>}
											<span>{formatRelative(issue.githubUpdatedAt)}</span>
											{issue.commentCount > 0 && (
												<span className="flex items-center gap-0.5">
													<MessageCircle className="size-2.5" />
													{issue.commentCount}
												</span>
											)}
										</div>
									</div>
								</Link>
							))}
						</div>
					</div>
				)}

				{/* Quick nav links */}
				<div className="grid grid-cols-2 gap-2">
					<Link
						href={`/${owner}/${name}/pulls`}
						className="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors no-underline"
					>
						<GitPullRequest className="size-3.5" />
						All PRs
					</Link>
					<Link
						href={`/${owner}/${name}/issues`}
						className="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors no-underline"
					>
						<CircleDot className="size-3.5" />
						All Issues
					</Link>
				</div>
			</div>
		</div>
	);
}

// --------------------------------------------------------------------------
// Small icon components (kept local to avoid cross-file coupling)
// --------------------------------------------------------------------------

function PrStateIcon({
	state,
	draft,
}: {
	state: "open" | "closed";
	draft: boolean;
}) {
	if (draft)
		return (
			<div className="mt-0.5 size-3.5 rounded-full border-2 border-muted-foreground shrink-0" />
		);
	if (state === "open")
		return (
			<svg
				className="mt-0.5 size-3.5 text-green-600 shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z" />
			</svg>
		);
	return (
		<svg
			className="mt-0.5 size-3.5 text-purple-600 shrink-0"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218Z" />
		</svg>
	);
}

function IssueStateIcon({ state }: { state: "open" | "closed" }) {
	if (state === "open")
		return (
			<svg
				className="mt-0.5 size-3.5 text-green-600 shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
				<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
			</svg>
		);
	return (
		<svg
			className="mt-0.5 size-3.5 text-purple-600 shrink-0"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z" />
			<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z" />
		</svg>
	);
}

function CheckDot({ conclusion }: { conclusion: string }) {
	if (conclusion === "success")
		return (
			<svg
				className="size-3 text-green-600 shrink-0 mt-0.5"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z" />
			</svg>
		);
	if (conclusion === "failure")
		return (
			<svg
				className="size-3 text-red-600 shrink-0 mt-0.5"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z" />
			</svg>
		);
	return (
		<svg
			className="size-3 text-yellow-600 shrink-0 mt-0.5"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
		</svg>
	);
}
