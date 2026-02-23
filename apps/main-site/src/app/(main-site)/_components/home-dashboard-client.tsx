"use client";

import { Result, useAtomValue } from "@effect-atom/atom-react";
import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandLinkItem,
	CommandList,
} from "@packages/ui/components/command";
import { useConvexAuthState } from "@packages/ui/components/convex-client-provider";
import {
	CircleDot,
	GitBranch,
	GitPullRequest,
	Search,
} from "@packages/ui/components/icons";
import { Link } from "@packages/ui/components/link";
import { ScrollArea } from "@packages/ui/components/scroll-area";
import { Skeleton } from "@packages/ui/components/skeleton";
import { GitHubIcon } from "@packages/ui/icons/index";
import { authClient } from "@packages/ui/lib/auth-client";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { Option } from "effect";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { triggerOpenSearchCommand } from "./search-command-events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
	githubUpdatedAt: number;
};

type DashboardIssueItem = {
	ownerLogin: string;
	repoName: string;
	number: number;
	state: "open" | "closed";
	title: string;
	authorLogin: string | null;
	authorAvatarUrl: string | null;
	labelNames: readonly string[];
	commentCount: number;
	githubUpdatedAt: number;
};

type RepoSummary = {
	ownerLogin: string;
	name: string;
	fullName: string;
	lastPushAt: number | null;
};

export type DashboardData = {
	githubLogin: string | null;
	recentPrs: ReadonlyArray<DashboardPrItem>;
	recentIssues: ReadonlyArray<DashboardIssueItem>;
	repos: ReadonlyArray<RepoSummary>;
};

type DashboardQuery = {
	readonly ownerLogin?: string;
};

// ---------------------------------------------------------------------------
// Shared hook — each section independently subscribes to the dashboard
// ---------------------------------------------------------------------------

function useDashboardData(
	initialData: DashboardData | null,
	query: DashboardQuery,
): {
	readonly data: DashboardData | null;
	readonly isWaitingForSignedInData: boolean;
} {
	const session = authClient.useSession();
	const { isReadyForQueries } = useConvexAuthState();
	const client = useProjectionQueries();
	const dashboardAtom = useMemo(
		() =>
			client.getHomeDashboard.subscription(
				{
					ownerLogin: query.ownerLogin,
				},
				{
					enabled: isReadyForQueries,
				},
			),
		[client, query.ownerLogin, isReadyForQueries],
	);
	const result = useAtomValue(dashboardAtom);
	const valueOption = Result.value(result);

	if (Option.isSome(valueOption)) {
		return {
			data: valueOption.value,
			isWaitingForSignedInData: false,
		};
	}

	const isWaitingForSignedInData =
		session.data !== null &&
		initialData !== null &&
		initialData.githubLogin === null &&
		Result.isInitial(result);

	if (initialData !== null && !isWaitingForSignedInData) {
		return {
			data: initialData,
			isWaitingForSignedInData: false,
		};
	}

	return {
		data: null,
		isWaitingForSignedInData,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sign-in CTA (pure client — no data dependency, just auth state)
// ---------------------------------------------------------------------------

export function SignInCta() {
	const session = authClient.useSession();

	if (session.isPending || session.data !== null) {
		return null;
	}

	return (
		<div className="mb-4 flex items-center gap-3 rounded-lg border border-dashed border-border bg-card/60 px-4 py-3">
			<GitHubIcon className="size-5 shrink-0 text-foreground/40" />
			<div className="min-w-0 flex-1">
				<p className="text-xs font-medium text-foreground">
					Sign in to see your personal feed
				</p>
				<p className="text-[11px] text-muted-foreground">
					Review requests, your PRs, and what&apos;s changed since you last
					looked.
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
	);
}

// ---------------------------------------------------------------------------
// Command Palette
// ---------------------------------------------------------------------------

export function CommandPaletteClient({
	initialData,
	query,
}: {
	initialData?: DashboardData;
	query: DashboardQuery;
}) {
	const { data, isWaitingForSignedInData } = useDashboardData(
		initialData ?? null,
		query,
	);

	if (data === null) {
		return <Skeleton className="h-10 w-full rounded-lg" />;
	}

	if (isWaitingForSignedInData) {
		return <Skeleton className="h-10 w-full rounded-lg" />;
	}

	return (
		<DashboardCommandPalette
			repos={data.repos}
			prs={data.recentPrs}
			issues={data.recentIssues}
			scopeOwnerLogin={query.ownerLogin ?? null}
		/>
	);
}

function DashboardCommandPalette({
	repos,
	prs,
	issues,
	scopeOwnerLogin,
}: {
	repos: ReadonlyArray<RepoSummary>;
	prs: ReadonlyArray<DashboardPrItem>;
	issues: ReadonlyArray<DashboardIssueItem>;
	scopeOwnerLogin: string | null;
}) {
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	// Auto-focus on mount
	useEffect(() => {
		const timeout = setTimeout(() => {
			inputRef.current?.focus();
		}, 100);
		return () => clearTimeout(timeout);
	}, []);

	const normalizedQuery = query.trim().toLowerCase();

	const filteredRepos = useMemo(() => {
		if (normalizedQuery.length === 0) return [];
		return repos
			.filter(
				(repo) =>
					repo.fullName.toLowerCase().includes(normalizedQuery) ||
					repo.name.toLowerCase().includes(normalizedQuery),
			)
			.slice(0, 5);
	}, [repos, normalizedQuery]);

	const filteredPrs = useMemo(() => {
		if (normalizedQuery.length === 0) return [];
		return prs
			.filter(
				(pr) =>
					pr.title.toLowerCase().includes(normalizedQuery) ||
					String(pr.number).includes(normalizedQuery) ||
					(pr.authorLogin?.toLowerCase().includes(normalizedQuery) ?? false),
			)
			.slice(0, 5);
	}, [prs, normalizedQuery]);

	const filteredIssues = useMemo(() => {
		if (normalizedQuery.length === 0) return [];
		return issues
			.filter(
				(issue) =>
					issue.title.toLowerCase().includes(normalizedQuery) ||
					String(issue.number).includes(normalizedQuery) ||
					(issue.authorLogin?.toLowerCase().includes(normalizedQuery) ??
						false) ||
					issue.labelNames.some((label) =>
						label.toLowerCase().includes(normalizedQuery),
					),
			)
			.slice(0, 5);
	}, [issues, normalizedQuery]);

	const hasResults =
		filteredRepos.length > 0 ||
		filteredPrs.length > 0 ||
		filteredIssues.length > 0;

	const clearQuery = useCallback(() => {
		setQuery("");
	}, []);

	const scopeLabel =
		scopeOwnerLogin === null ? "all" : `org:${scopeOwnerLogin}`;

	return (
		<>
			<Button
				variant="outline"
				className="md:hidden h-12 w-full items-center justify-start gap-2 rounded-xl border-border/70 bg-card/70 px-3 text-left shadow-sm"
				onClick={() => {
					triggerOpenSearchCommand();
				}}
			>
				<Search className="size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] font-medium text-foreground">
						Search FasterGH
					</div>
					<div className="truncate text-[11px] text-muted-foreground">
						Repos, pull requests, issues, and actions
					</div>
				</div>
				<Badge
					variant="secondary"
					className="h-5 shrink-0 px-1.5 font-mono text-[10px]"
				>
					{scopeLabel}
				</Badge>
			</Button>

			<Command
				shouldFilter={false}
				className="hidden md:flex rounded-lg border border-border/60 bg-card/60 shadow-sm backdrop-blur-sm"
			>
				<CommandInput
					ref={inputRef}
					placeholder="Jump to a repository, pull request, or issue..."
					value={query}
					onValueChange={setQuery}
				/>
				{normalizedQuery.length > 0 && (
					<CommandList className="max-h-[260px]">
						{!hasResults && (
							<CommandEmpty>No results for &ldquo;{query}&rdquo;</CommandEmpty>
						)}
						{filteredRepos.length > 0 && (
							<CommandGroup heading="Repositories">
								{filteredRepos.map((repo) => (
									<CommandLinkItem
										key={repo.fullName}
										value={repo.fullName}
										href={`/${repo.ownerLogin}/${repo.name}`}
										onBeforeNavigate={clearQuery}
									>
										<GitBranch className="size-3.5 text-muted-foreground" />
										<span className="flex-1 truncate text-sm">
											{repo.fullName}
										</span>
									</CommandLinkItem>
								))}
							</CommandGroup>
						)}
						{filteredPrs.length > 0 && (
							<CommandGroup heading="Pull Requests">
								{filteredPrs.map((pr) => (
									<CommandLinkItem
										key={`${pr.ownerLogin}/${pr.repoName}#${pr.number}`}
										value={`pr-${pr.ownerLogin}/${pr.repoName}#${pr.number}`}
										href={`/${pr.ownerLogin}/${pr.repoName}/pull/${pr.number}`}
										onBeforeNavigate={clearQuery}
									>
										<GitPullRequest className="size-3.5 text-status-open" />
										<div className="min-w-0 flex-1">
											<span className="truncate text-sm">{pr.title}</span>
											<span className="ml-2 font-mono text-[10px] text-muted-foreground/60">
												{pr.ownerLogin}/{pr.repoName} #{pr.number}
											</span>
										</div>
									</CommandLinkItem>
								))}
							</CommandGroup>
						)}
						{filteredIssues.length > 0 && (
							<CommandGroup heading="Issues">
								{filteredIssues.map((issue) => (
									<CommandLinkItem
										key={`${issue.ownerLogin}/${issue.repoName}#${issue.number}`}
										value={`issue-${issue.ownerLogin}/${issue.repoName}#${issue.number}`}
										href={`/${issue.ownerLogin}/${issue.repoName}/issues/${issue.number}`}
										onBeforeNavigate={clearQuery}
									>
										<CircleDot className="size-3.5 text-status-open" />
										<div className="min-w-0 flex-1">
											<span className="truncate text-sm">{issue.title}</span>
											<span className="ml-2 font-mono text-[10px] text-muted-foreground/60">
												{issue.ownerLogin}/{issue.repoName} #{issue.number}
											</span>
										</div>
									</CommandLinkItem>
								))}
							</CommandGroup>
						)}
					</CommandList>
				)}
			</Command>
		</>
	);
}

// ---------------------------------------------------------------------------
// Pull Requests Column
// ---------------------------------------------------------------------------

export function PrColumnClient({
	initialData,
	query,
}: {
	initialData?: DashboardData;
	query: DashboardQuery;
}) {
	const { data, isWaitingForSignedInData } = useDashboardData(
		initialData ?? null,
		query,
	);

	if (data === null) {
		return <DashboardColumnSkeleton title="Pull Requests" />;
	}

	if (isWaitingForSignedInData) {
		return <DashboardColumnSkeleton title="Pull Requests" />;
	}

	return (
		<Column
			title="Pull Requests"
			icon={<GitPullRequest className="size-3.5" />}
			count={data.recentPrs.length}
		>
			{data.recentPrs.length === 0 && (
				<EmptyState>No recent pull requests.</EmptyState>
			)}
			{data.recentPrs.map((pr) => (
				<PrRow key={`${pr.ownerLogin}/${pr.repoName}#${pr.number}`} pr={pr} />
			))}
		</Column>
	);
}

// ---------------------------------------------------------------------------
// Issues Column
// ---------------------------------------------------------------------------

export function IssuesColumnClient({
	initialData,
	query,
}: {
	initialData?: DashboardData;
	query: DashboardQuery;
}) {
	const { data, isWaitingForSignedInData } = useDashboardData(
		initialData ?? null,
		query,
	);

	if (data === null) {
		return <DashboardColumnSkeleton title="Issues" />;
	}

	if (isWaitingForSignedInData) {
		return <DashboardColumnSkeleton title="Issues" />;
	}

	return (
		<Column
			title="Issues"
			icon={<CircleDot className="size-3.5" />}
			count={data.recentIssues.length}
		>
			{data.recentIssues.length === 0 && (
				<EmptyState>No recent issues.</EmptyState>
			)}
			{data.recentIssues.map((issue) => (
				<IssueRow
					key={`${issue.ownerLogin}/${issue.repoName}#${issue.number}`}
					issue={issue}
				/>
			))}
		</Column>
	);
}

// ---------------------------------------------------------------------------
// Repositories Column
// ---------------------------------------------------------------------------

export function ReposColumnClient({
	initialData,
	query,
}: {
	initialData?: DashboardData;
	query: DashboardQuery;
}) {
	const { data, isWaitingForSignedInData } = useDashboardData(
		initialData ?? null,
		query,
	);

	if (data === null) {
		return <DashboardColumnSkeleton title="Repositories" />;
	}

	if (isWaitingForSignedInData) {
		return <DashboardColumnSkeleton title="Repositories" />;
	}

	return (
		<Column
			title="Repositories"
			icon={<GitBranch className="size-3.5" />}
			count={data.repos.length}
		>
			{data.repos.length === 0 && (
				<EmptyState>No repositories connected yet.</EmptyState>
			)}
			{data.repos.map((repo) => (
				<RepoRow key={repo.fullName} repo={repo} />
			))}
		</Column>
	);
}

// ---------------------------------------------------------------------------
// Column container
// ---------------------------------------------------------------------------

function Column({
	title,
	icon,
	count,
	children,
}: {
	title: string;
	icon: ReactNode;
	count: number;
	children: ReactNode;
}) {
	return (
		<section className="min-w-0">
			<div className="mb-1.5 flex items-center justify-between gap-2">
				<h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
					{icon}
					{title}
				</h2>
				{count > 0 && (
					<span className="font-mono text-[10px] text-muted-foreground/50">
						{count}
					</span>
				)}
			</div>
			<div className="overflow-hidden rounded-lg border border-border/60 bg-card/30">
				<ScrollArea className="h-[calc(100vh-220px)]">{children}</ScrollArea>
			</div>
		</section>
	);
}

function DashboardColumnSkeleton({ title }: { title: string }) {
	return (
		<section className="min-w-0">
			<div className="mb-1.5 flex items-center justify-between gap-2">
				<h2 className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
					{title}
				</h2>
			</div>
			<div className="overflow-hidden rounded-lg border border-border/60 bg-card/30">
				<div className="space-y-2 p-2">
					{[1, 2, 3].map((i) => (
						<div key={i} className="flex items-center gap-2">
							<Skeleton className="size-8 rounded-md" />
							<div className="flex-1 space-y-1">
								<Skeleton className="h-3.5 w-3/4" />
								<Skeleton className="h-2.5 w-1/2" />
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

function EmptyState({ children }: { children: ReactNode }) {
	return (
		<div className="px-4 py-10 text-center">
			<p className="font-mono text-[11px] text-muted-foreground/50">
				{children}
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Pull Request Row
// ---------------------------------------------------------------------------

function PrRow({ pr }: { pr: DashboardPrItem }) {
	return (
		<Link
			href={`/${pr.ownerLogin}/${pr.repoName}/pull/${pr.number}`}
			className="flex items-center gap-2.5 border-b border-border/30 px-3 py-2 no-underline transition-colors hover:bg-accent/50 last:border-b-0"
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
				</div>
			</div>
		</Link>
	);
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
			<div className="mt-0.5 size-3.5 shrink-0 rounded-full border-2 border-muted-foreground/50" />
		);
	}
	if (state === "open") {
		return (
			<GitPullRequest className="mt-0.5 size-3.5 shrink-0 text-status-open" />
		);
	}
	return (
		<GitPullRequest className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
	);
}

// ---------------------------------------------------------------------------
// Issue Row
// ---------------------------------------------------------------------------

function IssueRow({ issue }: { issue: DashboardIssueItem }) {
	return (
		<Link
			href={`/${issue.ownerLogin}/${issue.repoName}/issues/${issue.number}`}
			className="flex items-center gap-2.5 border-b border-border/30 px-3 py-2 no-underline transition-colors hover:bg-accent/50 last:border-b-0"
		>
			<CircleDot
				className={cn(
					"mt-0.5 size-3.5 shrink-0",
					issue.state === "open" ? "text-status-open" : "text-muted-foreground",
				)}
			/>
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13px] font-medium text-foreground leading-tight">
					{issue.title}
				</p>
				<div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
					<span className="truncate">
						{issue.ownerLogin}/{issue.repoName}
					</span>
					<span className="text-border">|</span>
					<span>#{issue.number}</span>
					<span className="text-border">|</span>
					<span>{formatRelative(issue.githubUpdatedAt)}</span>
				</div>
			</div>
			{issue.labelNames.length > 0 && (
				<div className="flex shrink-0 gap-1">
					{issue.labelNames.slice(0, 2).map((label) => (
						<Badge key={label} variant="outline" className="text-[10px]">
							{label}
						</Badge>
					))}
					{issue.labelNames.length > 2 && (
						<span className="font-mono text-[10px] text-muted-foreground/40">
							+{issue.labelNames.length - 2}
						</span>
					)}
				</div>
			)}
		</Link>
	);
}

// ---------------------------------------------------------------------------
// Repository Row
// ---------------------------------------------------------------------------

function RepoRow({ repo }: { repo: RepoSummary }) {
	return (
		<Link
			href={`/${repo.ownerLogin}/${repo.name}`}
			className="flex items-center justify-between gap-2 border-b border-border/30 px-3 py-2 no-underline transition-colors hover:bg-accent/50 last:border-b-0"
		>
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13px] font-medium text-foreground leading-tight">
					{repo.fullName}
				</p>
				{repo.lastPushAt !== null && (
					<div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
						{formatRelative(repo.lastPushAt)}
					</div>
				)}
			</div>
		</Link>
	);
}
