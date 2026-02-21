"use client";

import { Result, useAtomValue } from "@effect-atom/atom-react";
import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import { Button } from "@packages/ui/components/button";
import {
	Activity,
	Eye,
	GitBranch,
	GitPullRequest,
	MessageCircle,
	User,
} from "@packages/ui/components/icons";
import { Link } from "@packages/ui/components/link";
import { Skeleton } from "@packages/ui/components/skeleton";
import { GitHubIcon } from "@packages/ui/icons/index";
import { authClient } from "@packages/ui/lib/auth-client";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { type ReactNode, useMemo, useState } from "react";

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

const EmptyPayload: Record<string, never> = {};

type DashboardPrItem = {
	ownerLogin: string;
	repoName: string;
	number: number;
	state: "open" | "closed";
	draft: boolean;
	title: string;
	authorLogin: string | null;
	authorAvatarUrl: string | null;
	commentCount: number;
	lastCheckConclusion: string | null;
	githubUpdatedAt: number;
};

type ActivityItem = {
	ownerLogin: string;
	repoName: string;
	activityType: string;
	title: string;
	description: string | null;
	actorLogin: string | null;
	actorAvatarUrl: string | null;
	entityNumber: number | null;
	createdAt: number;
};

type RepoSummary = {
	ownerLogin: string;
	name: string;
	fullName: string;
	openPrCount: number;
	openIssueCount: number;
	failingCheckCount: number;
	lastPushAt: number | null;
};

export type DashboardData = {
	githubLogin: string | null;
	yourPrs: ReadonlyArray<DashboardPrItem>;
	needsAttentionPrs: ReadonlyArray<DashboardPrItem>;
	recentPrs: ReadonlyArray<DashboardPrItem>;
	recentActivity: ReadonlyArray<ActivityItem>;
	repos: ReadonlyArray<RepoSummary>;
};

type AttentionItem = {
	id: string;
	path: string;
	repoLabel: string;
	title: string;
	number: number;
	reason: string;
	source: "review" | "owned";
	githubUpdatedAt: number;
	hasFailingChecks: boolean;
};

type AttentionScope = "all" | "reviews" | "yours";

function buildAttentionQueue(data: DashboardData): Array<AttentionItem> {
	const next = new Map<string, AttentionItem>();

	// PRs where you're a requested reviewer / assignee — highest priority
	for (const pr of data.needsAttentionPrs) {
		const id = `${pr.ownerLogin}/${pr.repoName}#${pr.number}`;
		next.set(id, {
			id,
			path: `/${pr.ownerLogin}/${pr.repoName}/pulls/${pr.number}`,
			repoLabel: `${pr.ownerLogin}/${pr.repoName}`,
			title: pr.title,
			number: pr.number,
			reason: "Review requested",
			source: "review",
			githubUpdatedAt: pr.githubUpdatedAt,
			hasFailingChecks: pr.lastCheckConclusion === "failure",
		});
	}

	// Your own PRs — show them so you can track progress
	for (const pr of data.yourPrs) {
		const id = `${pr.ownerLogin}/${pr.repoName}#${pr.number}`;
		if (next.has(id)) continue; // already in as a review item
		const hasFailingChecks = pr.lastCheckConclusion === "failure";
		next.set(id, {
			id,
			path: `/${pr.ownerLogin}/${pr.repoName}/pulls/${pr.number}`,
			repoLabel: `${pr.ownerLogin}/${pr.repoName}`,
			title: pr.title,
			number: pr.number,
			reason: hasFailingChecks ? "CI failing" : "Your PR",
			source: "owned",
			githubUpdatedAt: pr.githubUpdatedAt,
			hasFailingChecks,
		});
	}

	// Sort: reviews first, then by most recently updated
	return [...next.values()].sort((a, b) => {
		if (a.source !== b.source) return a.source === "review" ? -1 : 1;
		return b.githubUpdatedAt - a.githubUpdatedAt;
	});
}

export function HomeDashboard({
	initialDashboard,
}: {
	initialDashboard: DashboardData;
}) {
	const session = authClient.useSession();
	const client = useProjectionQueries();
	const dashboardAtom = useMemo(
		() => client.getHomeDashboard.subscription(EmptyPayload),
		[client],
	);
	const dashboardResult = useAtomValue(dashboardAtom);
	const data = useSubscriptionWithInitial(dashboardAtom, initialDashboard);
	const [attentionScope, setAttentionScope] = useState<AttentionScope>("all");

	if (session.isPending || Result.isInitial(dashboardResult)) {
		return <DashboardSkeleton />;
	}

	const isSignedIn = session.data !== null;
	const attentionQueue = buildAttentionQueue(data);
	const filteredQueue =
		attentionScope === "reviews"
			? attentionQueue.filter((item) => item.source === "review")
			: attentionScope === "yours"
				? attentionQueue.filter((item) => item.source === "owned")
				: attentionQueue;

	const reviewCount = attentionQueue.filter(
		(i) => i.source === "review",
	).length;
	const yourPrCount = data.yourPrs.length;
	const yourFailingCount = data.yourPrs.filter(
		(pr) => pr.lastCheckConclusion === "failure",
	).length;

	// Build a contextual summary — what's fresh for *you*
	const summaryParts: Array<string> = [];
	if (reviewCount > 0) {
		summaryParts.push(
			`${reviewCount} PR${reviewCount === 1 ? "" : "s"} waiting for your review`,
		);
	}
	if (yourFailingCount > 0) {
		summaryParts.push(
			`${yourFailingCount} of your PR${yourFailingCount === 1 ? "" : "s"} failing CI`,
		);
	} else if (yourPrCount > 0) {
		summaryParts.push(
			`${yourPrCount} open PR${yourPrCount === 1 ? "" : "s"} by you`,
		);
	}
	const summaryText =
		summaryParts.length > 0
			? summaryParts.join(" · ")
			: isSignedIn
				? "All clear — nothing needs your attention"
				: "Sign in to see what needs your attention";

	return (
		<div className="h-full overflow-y-auto bg-dotgrid">
			<div className="px-4 py-5 md:px-8 md:py-6">
				{/* ── Header ─────────────────────────────────── */}
				<div className="mb-6">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h1 className="text-xl font-bold tracking-tight text-foreground">
								{data.githubLogin !== null
									? `${data.githubLogin}'s Workbench`
									: isSignedIn
										? "Team Workbench"
										: "QuickHub"}
							</h1>
							<p className="mt-1.5 font-mono text-[11px] text-muted-foreground/60">
								{summaryText}
							</p>
						</div>
						<Button
							asChild
							size="sm"
							variant="outline"
							className="h-7 text-xs font-mono"
						>
							<Link href="/inbox">Inbox</Link>
						</Button>
					</div>
				</div>

				{!isSignedIn && (
					<div className="mb-5 flex items-center gap-3 rounded-lg border border-dashed border-border bg-card/60 px-4 py-3">
						<GitHubIcon className="size-5 shrink-0 text-foreground/40" />
						<div className="min-w-0 flex-1">
							<p className="text-xs font-medium text-foreground">
								Sign in to see your personal feed
							</p>
							<p className="text-[11px] text-muted-foreground">
								Review requests, your PRs, and what&apos;s changed since you
								last looked.
							</p>
						</div>
						<Button
							size="sm"
							className="h-7 shrink-0 gap-1.5 text-xs"
							onClick={() => {
								authClient.signIn.social({ provider: "github" });
							}}
						>
							<GitHubIcon className="size-3" />
							Sign in
						</Button>
					</div>
				)}

				{/* ── Main grid ──────────────────────────────── */}
				<div className="grid gap-5 xl:grid-cols-12">
					<div className="space-y-5 xl:col-span-8">
						<AttentionQueueCard
							items={filteredQueue}
							scope={attentionScope}
							onScopeChange={setAttentionScope}
						/>

						<PrListCard
							title="Your Pull Requests"
							emptyLabel="No open PRs by you"
							icon={<User className="size-3.5 text-emerald-500" />}
							prs={data.yourPrs}
							isOwned
						/>

						<ActivityCard items={data.recentActivity} />
					</div>

					<div className="space-y-5 xl:col-span-4">
						<RecentReposCard yourPrs={data.yourPrs} />
						<PrListCard
							title="Recently Active PRs"
							emptyLabel="No recent pull requests"
							icon={<GitBranch className="size-3.5 text-muted-foreground" />}
							prs={data.recentPrs}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

function AttentionQueueCard({
	items,
	scope,
	onScopeChange,
}: {
	items: ReadonlyArray<AttentionItem>;
	scope: AttentionScope;
	onScopeChange: (scope: AttentionScope) => void;
}) {
	const scopeOptions: Array<{ value: AttentionScope; label: string }> = [
		{ value: "all", label: "All" },
		{ value: "reviews", label: "Reviews" },
		{ value: "yours", label: "Yours" },
	];

	return (
		<section>
			<div className="mb-2 flex items-center justify-between gap-2">
				<h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
					<Eye className="size-3.5 text-amber-500" />
					Needs Attention
					{items.length > 0 && (
						<span className="font-mono text-[10px] font-normal text-muted-foreground/50">
							{items.length}
						</span>
					)}
				</h2>
				<div className="flex gap-px rounded-md border border-border/80 bg-border/40 overflow-hidden">
					{scopeOptions.map((opt) => (
						<button
							key={opt.value}
							type="button"
							className={cn(
								"px-2.5 py-1 text-[10px] font-medium transition-colors",
								scope === opt.value
									? "bg-foreground text-background"
									: "bg-card text-muted-foreground hover:text-foreground",
							)}
							onClick={() => onScopeChange(opt.value)}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>

			{items.length === 0 && (
				<div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-6 text-center">
					<p className="font-mono text-[11px] text-muted-foreground/50">
						Nothing needs your attention right now.
					</p>
				</div>
			)}

			{items.length > 0 && (
				<div className="overflow-hidden rounded-lg border border-border/80">
					{items.slice(0, 14).map((item, i) => (
						<Link
							key={item.id}
							href={item.path}
							className={cn(
								"flex items-center gap-3 px-3 py-2.5 no-underline transition-colors hover:bg-accent/60",
								i > 0 && "border-t border-border/50",
							)}
						>
							<div className="min-w-0 flex-1">
								<p className="truncate text-[13px] font-medium text-foreground leading-tight">
									{item.title}
								</p>
								<div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
									<span>{item.repoLabel}</span>
									<span className="text-border">|</span>
									<span>#{item.number}</span>
									<span className="text-border">|</span>
									<span>{formatRelative(item.githubUpdatedAt)}</span>
								</div>
							</div>
							<span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
								{item.reason}
							</span>
						</Link>
					))}
				</div>
			)}
		</section>
	);
}

function PrListCard({
	title,
	icon,
	prs,
	emptyLabel,
	isOwned = false,
}: {
	title: string;
	icon: ReactNode;
	prs: ReadonlyArray<DashboardPrItem>;
	emptyLabel: string;
	isOwned?: boolean;
}) {
	return (
		<section>
			<div className="mb-2 flex items-center justify-between gap-2">
				<h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
					{icon}
					{title}
				</h2>
				{prs.length > 0 && (
					<span className="font-mono text-[10px] text-muted-foreground/50">
						{prs.length}
					</span>
				)}
			</div>

			{prs.length === 0 && (
				<div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-5 text-center">
					<p className="font-mono text-[11px] text-muted-foreground/50">
						{emptyLabel}
					</p>
				</div>
			)}

			{prs.length > 0 && (
				<div className="overflow-hidden rounded-lg border border-border/80">
					{prs.slice(0, 8).map((pr, i) => (
						<Link
							key={`${pr.ownerLogin}/${pr.repoName}#${pr.number}`}
							href={`/${pr.ownerLogin}/${pr.repoName}/pulls/${pr.number}`}
							className={cn(
								"flex items-center gap-2.5 px-3 py-2 no-underline transition-colors hover:bg-accent/60",
								i > 0 && "border-t border-border/50",
							)}
						>
							<PrStateIcon state={pr.state} draft={pr.draft} />
							<div className="min-w-0 flex-1">
								<p className="truncate text-[13px] font-medium text-foreground leading-tight">
									{pr.title}
								</p>
								<div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
									<span className="truncate">
										{pr.ownerLogin}/{pr.repoName}
									</span>
									<span className="text-border">|</span>
									<span>#{pr.number}</span>
									<span className="text-border">|</span>
									<span>{formatRelative(pr.githubUpdatedAt)}</span>
									{pr.commentCount > 0 && (
										<>
											<span className="text-border">|</span>
											<span className="flex items-center gap-0.5">
												<MessageCircle className="size-2.5" />
												{pr.commentCount}
											</span>
										</>
									)}
								</div>
							</div>
							{isOwned && pr.lastCheckConclusion === "failure" && (
								<span className="shrink-0 font-mono text-[10px] text-red-500/70">
									CI failing
								</span>
							)}
						</Link>
					))}
				</div>
			)}
		</section>
	);
}

function ActivityCard({ items }: { items: ReadonlyArray<ActivityItem> }) {
	return (
		<section>
			<div className="mb-2">
				<h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
					<Activity className="size-3.5 text-sky-500" />
					Recent Activity
				</h2>
			</div>

			{items.length === 0 && (
				<div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-5 text-center">
					<p className="font-mono text-[11px] text-muted-foreground/50">
						No recent activity yet.
					</p>
				</div>
			)}

			{items.length > 0 && (
				<div className="overflow-hidden rounded-lg border border-border/80">
					{items.slice(0, 14).map((activity, index) => (
						<ActivityRow
							key={`${activity.ownerLogin}/${activity.repoName}-${activity.createdAt}-${index}`}
							activity={activity}
							isFirst={index === 0}
						/>
					))}
				</div>
			)}
		</section>
	);
}

function RecentReposCard({
	yourPrs,
}: {
	yourPrs: ReadonlyArray<DashboardPrItem>;
}) {
	// Derive recent repos from the user's PRs — deduped, ordered by most recent activity
	const seen = new Set<string>();
	const recentRepos: Array<{
		key: string;
		ownerLogin: string;
		repoName: string;
		lastActivity: number;
	}> = [];

	// yourPrs is already sorted by githubUpdatedAt desc from the server
	for (const pr of yourPrs) {
		const key = `${pr.ownerLogin}/${pr.repoName}`;
		if (seen.has(key)) continue;
		seen.add(key);
		recentRepos.push({
			key,
			ownerLogin: pr.ownerLogin,
			repoName: pr.repoName,
			lastActivity: pr.githubUpdatedAt,
		});
		if (recentRepos.length >= 5) break;
	}

	return (
		<section>
			<div className="mb-2">
				<h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
					<GitBranch className="size-3.5 text-muted-foreground" />
					Recent Repositories
				</h2>
			</div>

			{recentRepos.length === 0 && (
				<div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-5 text-center">
					<p className="font-mono text-[11px] text-muted-foreground/50">
						Open a PR to see your repos here.
					</p>
				</div>
			)}

			{recentRepos.length > 0 && (
				<div className="overflow-hidden rounded-lg border border-border/80">
					{recentRepos.map((repo, i) => (
						<Link
							key={repo.key}
							href={`/${repo.ownerLogin}/${repo.repoName}/pulls`}
							className={cn(
								"flex items-center justify-between gap-2 px-3 py-2 no-underline transition-colors hover:bg-accent/60",
								i > 0 && "border-t border-border/50",
							)}
						>
							<p className="truncate text-[13px] font-medium text-foreground leading-tight">
								{repo.key}
							</p>
							<span className="shrink-0 font-mono text-[10px] text-muted-foreground/40">
								{formatRelative(repo.lastActivity)}
							</span>
						</Link>
					))}
				</div>
			)}
		</section>
	);
}

function ActivityRow({
	activity,
	isFirst,
}: {
	activity: ActivityItem;
	isFirst: boolean;
}) {
	const href = (() => {
		const base = `/${activity.ownerLogin}/${activity.repoName}`;
		if (activity.entityNumber === null) return base;
		if (
			activity.activityType === "pr_opened" ||
			activity.activityType === "pr_closed" ||
			activity.activityType === "pr_merged" ||
			activity.activityType === "pr_review"
		) {
			return `${base}/pulls/${activity.entityNumber}`;
		}
		if (
			activity.activityType === "issue_opened" ||
			activity.activityType === "issue_closed"
		) {
			return `${base}/issues/${activity.entityNumber}`;
		}
		return base;
	})();

	return (
		<Link
			href={href}
			className={cn(
				"flex items-center gap-3 px-3 py-2 no-underline transition-colors hover:bg-accent/60",
				!isFirst && "border-t border-border/50",
			)}
		>
			{activity.actorAvatarUrl !== null ? (
				<Avatar className="size-5 ring-1 ring-border/50">
					<AvatarImage
						src={activity.actorAvatarUrl}
						alt={activity.actorLogin ?? ""}
					/>
					<AvatarFallback className="text-[8px] font-mono">
						{activity.actorLogin?.[0]?.toUpperCase() ?? "?"}
					</AvatarFallback>
				</Avatar>
			) : (
				<div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted/60">
					<Activity className="size-2.5 text-muted-foreground/50" />
				</div>
			)}
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13px] text-foreground leading-tight">
					<span className="font-medium">
						{activity.actorLogin ?? "Someone"}
					</span>{" "}
					<span className="text-muted-foreground">
						{activityVerb(activity.activityType)}
					</span>{" "}
					{activity.title}
				</p>
				<div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
					<span>
						{activity.ownerLogin}/{activity.repoName}
					</span>
					<span className="text-border">|</span>
					<span>{formatRelative(activity.createdAt)}</span>
				</div>
			</div>
		</Link>
	);
}

function activityVerb(type: string): string {
	switch (type) {
		case "pr_opened":
			return "opened PR";
		case "pr_closed":
			return "closed PR";
		case "pr_merged":
			return "merged PR";
		case "pr_review":
			return "reviewed PR";
		case "issue_opened":
			return "opened issue";
		case "issue_closed":
			return "closed issue";
		case "push":
			return "pushed to";
		default:
			return type.replace(/_/g, " ");
	}
}

function PrStateIcon({
	state,
	draft,
}: {
	state: "open" | "closed";
	draft: boolean;
}) {
	if (draft) {
		return (
			<div className="mt-0.5 size-3.5 shrink-0 rounded-full border-2 border-muted-foreground" />
		);
	}
	if (state === "open") {
		return (
			<GitPullRequest className="mt-0.5 size-3.5 shrink-0 text-green-600" />
		);
	}
	return (
		<GitPullRequest className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
	);
}

export function DashboardSkeleton() {
	return (
		<div className="h-full overflow-y-auto bg-dotgrid px-4 py-5 md:px-8 md:py-6">
			<Skeleton className="mb-2 h-5 w-44" />
			<Skeleton className="mb-6 h-3 w-72" />
			<div className="grid gap-5 xl:grid-cols-12">
				<div className="space-y-5 xl:col-span-8">
					<Skeleton className="h-56 rounded-lg" />
					<Skeleton className="h-64 rounded-lg" />
					<Skeleton className="h-64 rounded-lg" />
				</div>
				<div className="space-y-5 xl:col-span-4">
					<Skeleton className="h-64 rounded-lg" />
					<Skeleton className="h-64 rounded-lg" />
				</div>
			</div>
		</div>
	);
}
