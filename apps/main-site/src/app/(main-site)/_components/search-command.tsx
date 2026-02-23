"use client";

import { Result, useAtomValue } from "@effect-atom/atom-react";
import { Badge } from "@packages/ui/components/badge";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandLinkItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@packages/ui/components/command";
import { useConvexAuthState } from "@packages/ui/components/convex-client-provider";
import {
	CircleDot,
	Clock3,
	FileCode2,
	GitHubIcon,
	GitPullRequest,
	Inbox,
	ListChecks,
	Rocket,
	Search,
} from "@packages/ui/components/icons";
import { Skeleton } from "@packages/ui/components/skeleton";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Option } from "effect";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	buildCanonicalGitHubSearch,
	parseSearchCommandQuery,
	type SearchCommandQuery,
} from "./search-command-dsl";
import { OPEN_SEARCH_COMMAND_EVENT } from "./search-command-events";
import {
	mergeRankedResults,
	type RankedResult,
} from "./search-command-shift-prevention";
import {
	buildQueryChips,
	getKeywordSuggestion,
	InputSuggestionHint,
	QueryBadgeRail,
	renderFilterIcon,
} from "./search-command-visuals";

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);

	return debounced;
}

function useRepoFromPathname() {
	const pathname = usePathname();
	return useMemo(() => {
		const segments = pathname.split("/").filter(Boolean);
		if (segments.length < 2) return null;
		const owner = segments[0];
		const name = segments[1];
		if (owner === undefined || name === undefined) return null;
		return { owner, name };
	}, [pathname]);
}

type SearchResultItem = {
	readonly type: "pr" | "issue";
	readonly number: number;
	readonly state: "open" | "closed" | "merged";
	readonly title: string;
	readonly authorLogin: string | null;
	readonly githubUpdatedAt: number;
};

type RepoSearchItem = {
	readonly repositoryId: number;
	readonly fullName: string;
	readonly ownerLogin: string;
	readonly name: string;
	readonly openPrCount: number;
	readonly openIssueCount: number;
	readonly failingCheckCount: number;
	readonly lastPushAt: number | null;
	readonly updatedAt: number;
};

type DashboardPrItem = {
	readonly ownerLogin: string;
	readonly repoName: string;
	readonly number: number;
	readonly state: "open" | "closed";
	readonly draft: boolean;
	readonly title: string;
	readonly authorLogin: string | null;
	readonly commentCount: number;
	readonly githubUpdatedAt: number;
};

type NavigationKind =
	| "repo"
	| "global"
	| "pr"
	| "issue"
	| "actions"
	| "code"
	| "notifications"
	| "recent";

type NavigationTarget = {
	readonly path: string;
	readonly title: string;
	readonly subtitle: string | null;
	readonly kind: NavigationKind;
};

type RecentEntry = {
	readonly path: string;
	readonly title: string;
	readonly subtitle: string | null;
	readonly kind: NavigationKind;
	readonly updatedAt: number;
};

const RECENT_KEY = "fastergh.recent.navigation";
const MAX_RECENT = 8;

const DEFAULT_RECENT: ReadonlyArray<RecentEntry> = [];

function getRecentEntries(): ReadonlyArray<RecentEntry> {
	if (typeof window === "undefined") return DEFAULT_RECENT;
	const raw = window.localStorage.getItem(RECENT_KEY);
	if (raw === null) return DEFAULT_RECENT;

	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return DEFAULT_RECENT;

		const validEntries = parsed
			.filter(
				(entry) =>
					typeof entry === "object" &&
					entry !== null &&
					"path" in entry &&
					"title" in entry &&
					"kind" in entry &&
					"updatedAt" in entry,
			)
			.filter(
				(entry) =>
					typeof entry.path === "string" &&
					typeof entry.title === "string" &&
					typeof entry.kind === "string" &&
					typeof entry.updatedAt === "number",
			)
			.map((entry) => {
				const subtitle =
					"subtitle" in entry && typeof entry.subtitle === "string"
						? entry.subtitle
						: null;
				return {
					path: entry.path,
					title: entry.title,
					subtitle,
					kind:
						entry.kind === "pr" ||
						entry.kind === "issue" ||
						entry.kind === "repo" ||
						entry.kind === "actions" ||
						entry.kind === "code" ||
						entry.kind === "notifications"
							? entry.kind
							: "recent",
					updatedAt: entry.updatedAt,
				};
			});

		return validEntries.slice(0, MAX_RECENT);
	} catch {
		return DEFAULT_RECENT;
	}
}

function saveRecentEntries(entries: ReadonlyArray<RecentEntry>) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(
		RECENT_KEY,
		JSON.stringify(entries.slice(0, MAX_RECENT)),
	);
}

function upsertRecent(
	entries: ReadonlyArray<RecentEntry>,
	target: NavigationTarget,
): ReadonlyArray<RecentEntry> {
	const now = Date.now();
	const next: Array<RecentEntry> = [
		{
			path: target.path,
			title: target.title,
			subtitle: target.subtitle,
			kind: target.kind,
			updatedAt: now,
		},
	];

	for (const entry of entries) {
		if (entry.path === target.path) continue;
		next.push(entry);
		if (next.length >= MAX_RECENT) break;
	}

	return next;
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

function IconForKind({ kind }: { kind: NavigationKind }) {
	if (kind === "pr")
		return <GitPullRequest className="size-4 text-status-open" />;
	if (kind === "issue")
		return <CircleDot className="size-4 text-status-open" />;
	if (kind === "actions") return <ListChecks className="size-4" />;
	if (kind === "code") return <FileCode2 className="size-4" />;
	if (kind === "notifications") return <Inbox className="size-4" />;
	if (kind === "repo") return <Search className="size-4" />;
	return <Clock3 className="size-4 text-muted-foreground" />;
}

function ScopeIndicator({
	repo,
	org,
	showClearHint,
}: {
	repo: { readonly owner: string; readonly name: string } | null;
	org: string | null;
	showClearHint: boolean;
}) {
	if (repo === null && org === null) return null;

	return (
		<div className="hidden sm:flex items-center gap-1.5 max-w-[18rem]">
			<Badge
				variant="secondary"
				className="h-6 gap-1 px-2 font-mono text-[10px]"
			>
				<FileCode2 className="size-3 text-status-repo" />
				{repo !== null ? (
					<span className="truncate max-w-[11rem]">
						{repo.owner}/{repo.name}
					</span>
				) : (
					<span className="truncate max-w-[11rem]">org:{org}</span>
				)}
			</Badge>
			{showClearHint && (
				<CommandShortcut className="text-[10px] tracking-normal">
					⌫ clear
				</CommandShortcut>
			)}
		</div>
	);
}

function RepoQuickActions({
	repo,
	onSelect,
	onGoToGitHub,
}: {
	repo: { readonly owner: string; readonly name: string };
	onSelect: (target: NavigationTarget) => void;
	onGoToGitHub: () => void;
}) {
	const base = `/${repo.owner}/${repo.name}`;

	const actions: ReadonlyArray<NavigationTarget> = [
		{
			path: `${base}/pulls`,
			title: "Open Pull Requests",
			subtitle: `${repo.owner}/${repo.name}`,
			kind: "repo",
		},
		{
			path: `${base}/issues`,
			title: "Open Issues",
			subtitle: `${repo.owner}/${repo.name}`,
			kind: "repo",
		},
		{
			path: `${base}/issues/new`,
			title: "Create New Issue",
			subtitle: `${repo.owner}/${repo.name}`,
			kind: "issue",
		},
		{
			path: `${base}/actions`,
			title: "Open Actions",
			subtitle: `${repo.owner}/${repo.name}`,
			kind: "actions",
		},
		{
			path: `${base}/tree/HEAD`,
			title: "Browse Code",
			subtitle: `${repo.owner}/${repo.name}`,
			kind: "code",
		},
		{
			path: "/notifications",
			title: "Open Notifications",
			subtitle: "Notifications",
			kind: "notifications",
		},
	];

	return (
		<CommandGroup heading="Quick Actions">
			{actions.map((action) => (
				<CommandLinkItem
					key={action.path}
					value={`${action.title} ${action.subtitle ?? ""}`}
					href={action.path}
					onBeforeNavigate={() => onSelect(action)}
				>
					<IconForKind kind={action.kind} />
					<span>{action.title}</span>
					{action.subtitle !== null && (
						<span className="ml-auto text-xs text-muted-foreground truncate max-w-[12rem]">
							{action.subtitle}
						</span>
					)}
				</CommandLinkItem>
			))}
			<CommandItem value="go to github github.com" onSelect={onGoToGitHub}>
				<GitHubIcon className="size-4 text-muted-foreground" />
				<span>Go to GitHub</span>
			</CommandItem>
		</CommandGroup>
	);
}

function QuickNumberNavigation({
	repo,
	query,
	onSelect,
}: {
	repo: { readonly owner: string; readonly name: string };
	query: string;
	onSelect: (target: NavigationTarget) => void;
}) {
	const directPr = /^pr\s*#?(\d+)$/i.exec(query);
	const directIssue = /^issue\s*#?(\d+)$/i.exec(query);
	const plainNumber = /^#?(\d+)$/.exec(query);

	const number = directPr?.[1] ?? directIssue?.[1] ?? plainNumber?.[1] ?? null;
	if (number === null) return null;

	const paths: Array<NavigationTarget> = [];

	if (directIssue?.[1] !== undefined) {
		paths.push({
			path: `/${repo.owner}/${repo.name}/issues/${number}`,
			title: `Open Issue #${number}`,
			subtitle: `${repo.owner}/${repo.name}`,
			kind: "issue",
		});
	} else if (directPr?.[1] !== undefined) {
		paths.push({
			path: `/${repo.owner}/${repo.name}/pull/${number}`,
			title: `Open Pull Request #${number}`,
			subtitle: `${repo.owner}/${repo.name}`,
			kind: "pr",
		});
	} else {
		paths.push(
			{
				path: `/${repo.owner}/${repo.name}/pull/${number}`,
				title: `Open Pull Request #${number}`,
				subtitle: `${repo.owner}/${repo.name}`,
				kind: "pr",
			},
			{
				path: `/${repo.owner}/${repo.name}/issues/${number}`,
				title: `Open Issue #${number}`,
				subtitle: `${repo.owner}/${repo.name}`,
				kind: "issue",
			},
		);
	}

	return (
		<CommandGroup heading="Jump">
			{paths.map((target) => (
				<CommandLinkItem
					key={target.path}
					value={`${target.title} ${target.subtitle ?? ""}`}
					href={target.path}
					onBeforeNavigate={() => onSelect(target)}
				>
					<IconForKind kind={target.kind} />
					<span>{target.title}</span>
					<CommandShortcut>Enter</CommandShortcut>
				</CommandLinkItem>
			))}
		</CommandGroup>
	);
}

function SearchResultRow({
	item,
	resultId,
	repo,
	onSelect,
	onPointerIntent,
}: {
	item: SearchResultItem;
	resultId: string;
	repo: { readonly owner: string; readonly name: string };
	onSelect: (target: NavigationTarget) => void;
	onPointerIntent: (
		resultId: string,
		pointer: { readonly x: number; readonly y: number },
	) => void;
}) {
	const kind: NavigationKind = item.type === "pr" ? "pr" : "issue";
	const segment = item.type === "pr" ? "pull" : "issues";
	const target: NavigationTarget = {
		path: `/${repo.owner}/${repo.name}/${segment}/${item.number}`,
		title: item.title,
		subtitle: `${item.type === "pr" ? "PR" : "Issue"} #${item.number}`,
		kind,
	};

	return (
		<CommandLinkItem
			value={`${item.type} ${item.number} ${item.title} ${item.authorLogin ?? ""}`}
			href={target.path}
			onBeforeNavigate={() => onSelect(target)}
			data-result-id={resultId}
			onPointerMove={(event) =>
				onPointerIntent(resultId, { x: event.clientX, y: event.clientY })
			}
		>
			<IconForKind kind={kind} />
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm">{item.title}</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span>#{item.number}</span>
					{item.authorLogin !== null && <span>{item.authorLogin}</span>}
					<span>{formatRelative(item.githubUpdatedAt)}</span>
				</div>
			</div>
			<span
				className={cn(
					"text-xs capitalize",
					item.state === "open"
						? "text-status-open"
						: item.state === "merged"
							? "text-status-merged"
							: "text-status-closed",
				)}
			>
				{item.state}
			</span>
		</CommandLinkItem>
	);
}

function SearchResults({
	repo,
	query,
	onSelect,
	focusedResultId,
	onPointerIntent,
}: {
	repo: { readonly owner: string; readonly name: string };
	query: SearchCommandQuery;
	onSelect: (target: NavigationTarget) => void;
	focusedResultId: string | null;
	onPointerIntent: (
		resultId: string,
		pointer: { readonly x: number; readonly y: number },
	) => void;
}) {
	const client = useProjectionQueries();
	const [displayedResults, setDisplayedResults] = useState<
		ReadonlyArray<RankedResult<SearchResultItem>>
	>([]);
	const searchText = query.textTokens.join(" ");
	const searchAtom = useMemo(
		() =>
			client.searchIssuesAndPrs.subscription({
				ownerLogin: repo.owner,
				name: repo.name,
				query: searchText,
				limit: 50,
				target:
					query.target === "issue" || query.target === "pr"
						? query.target
						: undefined,
				authorLogin: query.author ?? undefined,
				assigneeLogin: query.assignee ?? undefined,
				labels: query.labels.length > 0 ? [...query.labels] : undefined,
				state: query.state ?? undefined,
				updatedAfter: query.updatedAfter ?? undefined,
			}),
		[
			client,
			repo.owner,
			repo.name,
			searchText,
			query.target,
			query.author,
			query.assignee,
			query.labels,
			query.state,
			query.updatedAfter,
		],
	);
	const result = useAtomValue(searchAtom);

	const incomingResults = useMemo(() => {
		if (Result.isInitial(result)) return null;
		const valueOption = Result.value(result);
		if (Option.isNone(valueOption)) return [];

		const deduped = new Map<string, RankedResult<SearchResultItem>>();
		for (const item of valueOption.value) {
			const itemId = `${item.type}-${item.number}`;
			if (deduped.has(itemId)) continue;
			deduped.set(itemId, { id: itemId, item });
		}

		return [...deduped.values()];
	}, [result]);

	useEffect(() => {
		if (incomingResults === null) return;
		setDisplayedResults((previous) =>
			mergeRankedResults(previous, incomingResults, focusedResultId),
		);
	}, [incomingResults, focusedResultId]);

	if (Result.isInitial(result)) {
		if (displayedResults.length > 0) {
			const stalePrs = displayedResults
				.filter((entry) => entry.item.type === "pr")
				.map((entry) => entry);
			const staleIssues = displayedResults
				.filter((entry) => entry.item.type === "issue")
				.map((entry) => entry);

			return (
				<>
					{stalePrs.length > 0 && (
						<CommandGroup heading="Pull Requests">
							{stalePrs.map((entry) => (
								<SearchResultRow
									key={entry.id}
									item={entry.item}
									resultId={entry.id}
									repo={repo}
									onSelect={onSelect}
									onPointerIntent={onPointerIntent}
								/>
							))}
						</CommandGroup>
					)}
					{staleIssues.length > 0 && (
						<CommandGroup heading="Issues">
							{staleIssues.map((entry) => (
								<SearchResultRow
									key={entry.id}
									item={entry.item}
									resultId={entry.id}
									repo={repo}
									onSelect={onSelect}
									onPointerIntent={onPointerIntent}
								/>
							))}
						</CommandGroup>
					)}
					<CommandGroup heading="Refreshing">
						<CommandItem disabled value="refreshing results">
							<Skeleton className="size-4 rounded shrink-0" />
							<span className="text-xs text-muted-foreground">
								Updating results without moving your selection...
							</span>
						</CommandItem>
					</CommandGroup>
				</>
			);
		}

		return (
			<div className="px-2 py-3 space-y-2">
				{[1, 2, 3].map((i) => (
					<div key={i} className="flex items-center gap-2 px-2">
						<Skeleton className="size-4 rounded shrink-0" />
						<div className="flex-1 space-y-1">
							<Skeleton className="h-3.5 w-3/4" />
							<Skeleton className="h-2.5 w-1/2" />
						</div>
					</div>
				))}
			</div>
		);
	}

	if (displayedResults.length === 0) return null;

	const prs = displayedResults.filter((entry) => entry.item.type === "pr");
	const issues = displayedResults.filter(
		(entry) => entry.item.type === "issue",
	);

	return (
		<>
			{prs.length > 0 && (
				<CommandGroup heading="Pull Requests">
					{prs.map((entry) => (
						<SearchResultRow
							key={entry.id}
							item={entry.item}
							resultId={entry.id}
							repo={repo}
							onSelect={onSelect}
							onPointerIntent={onPointerIntent}
						/>
					))}
				</CommandGroup>
			)}
			{issues.length > 0 && (
				<CommandGroup heading="Issues">
					{issues.map((entry) => (
						<SearchResultRow
							key={entry.id}
							item={entry.item}
							resultId={entry.id}
							repo={repo}
							onSelect={onSelect}
							onPointerIntent={onPointerIntent}
						/>
					))}
				</CommandGroup>
			)}
		</>
	);
}

function GlobalWorkResults({
	query,
	onSelect,
}: {
	query: string;
	onSelect: (target: NavigationTarget) => void;
}) {
	const { isReadyForQueries } = useConvexAuthState();
	const client = useProjectionQueries();
	const dashboardAtom = useMemo(
		() =>
			client.getHomeDashboard.subscription(
				{},
				{
					enabled: isReadyForQueries,
				},
			),
		[client, isReadyForQueries],
	);
	const result = useAtomValue(dashboardAtom);

	if (Result.isInitial(result)) {
		return (
			<div className="px-2 py-3 space-y-2">
				{[1, 2, 3].map((i) => (
					<div key={i} className="flex items-center gap-2 px-2">
						<Skeleton className="size-4 rounded shrink-0" />
						<div className="flex-1 space-y-1">
							<Skeleton className="h-3.5 w-3/4" />
							<Skeleton className="h-2.5 w-1/2" />
						</div>
					</div>
				))}
			</div>
		);
	}

	const valueOption = Result.value(result);
	if (Option.isNone(valueOption)) return null;

	const dashboard = valueOption.value;
	const allItems: Array<DashboardPrItem> = [...dashboard.recentPrs];

	const deduped = new Map<string, DashboardPrItem>();
	for (const item of allItems) {
		const key = `${item.ownerLogin}/${item.repoName}#${item.number}`;
		if (!deduped.has(key)) {
			deduped.set(key, item);
		}
	}

	const normalized = query.trim().toLowerCase();
	const filtered = [...deduped.values()]
		.filter((item) => {
			const repo = `${item.ownerLogin}/${item.repoName}`.toLowerCase();
			const numberText = String(item.number);
			return (
				item.title.toLowerCase().includes(normalized) ||
				repo.includes(normalized) ||
				numberText.includes(normalized)
			);
		})
		.sort((a, b) => b.githubUpdatedAt - a.githubUpdatedAt)
		.slice(0, 12);

	if (filtered.length === 0) return null;

	return (
		<CommandGroup heading="Priority Work Across Repos">
			{filtered.map((item) => {
				const target: NavigationTarget = {
					path: `/${item.ownerLogin}/${item.repoName}/pull/${item.number}`,
					title: item.title,
					subtitle: `${item.ownerLogin}/${item.repoName} · PR #${item.number}`,
					kind: "pr",
				};

				return (
					<CommandLinkItem
						key={`${item.ownerLogin}/${item.repoName}#${item.number}`}
						value={`${item.title} ${item.ownerLogin}/${item.repoName} ${item.number}`}
						href={target.path}
						onBeforeNavigate={() => onSelect(target)}
					>
						<GitPullRequest className="size-4 text-status-open" />
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm">{item.title}</div>
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<span>
									{item.ownerLogin}/{item.repoName}
								</span>
								<span>#{item.number}</span>
								<span>{formatRelative(item.githubUpdatedAt)}</span>
							</div>
						</div>
					</CommandLinkItem>
				);
			})}
		</CommandGroup>
	);
}

function RepoResults({
	query,
	org,
	onSelect,
	heading = "Repositories",
	limit = 12,
}: {
	query: string;
	org?: string;
	onSelect: (target: NavigationTarget) => void;
	heading?: string;
	limit?: number;
}) {
	const { isReadyForQueries } = useConvexAuthState();
	const client = useProjectionQueries();
	const reposAtom = useMemo(
		() =>
			client.listRepos.subscription(
				{},
				{
					enabled: isReadyForQueries,
				},
			),
		[client, isReadyForQueries],
	);
	const result = useAtomValue(reposAtom);

	if (Result.isInitial(result)) {
		return (
			<div className="px-2 py-3 space-y-2">
				{Array.from({ length: Math.min(limit, 4) }, (_, i) => (
					<div key={i} className="flex items-center gap-2 px-2">
						<Skeleton className="size-4 rounded shrink-0" />
						<div className="flex-1 space-y-1">
							<Skeleton className="h-3.5 w-2/3" />
							<Skeleton className="h-2.5 w-1/3" />
						</div>
					</div>
				))}
			</div>
		);
	}

	const valueOption = Result.value(result);
	if (Option.isNone(valueOption)) return null;

	const repos: ReadonlyArray<RepoSearchItem> = valueOption.value;
	const normalizedQuery = query.trim().toLowerCase();
	const normalizedOrg = org?.trim().toLowerCase() ?? "";
	const filtered = repos
		.filter((repo) => {
			if (normalizedOrg.length > 0) {
				if (repo.ownerLogin.toLowerCase() !== normalizedOrg) return false;
			}
			if (normalizedQuery.length === 0) return true;
			return (
				repo.fullName.toLowerCase().includes(normalizedQuery) ||
				repo.ownerLogin.toLowerCase().includes(normalizedQuery) ||
				repo.name.toLowerCase().includes(normalizedQuery)
			);
		})
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, limit);

	if (filtered.length === 0) return null;

	return (
		<CommandGroup heading={heading}>
			{filtered.map((repo) => {
				const target: NavigationTarget = {
					path: `/${repo.ownerLogin}/${repo.name}`,
					title: repo.fullName,
					subtitle: null,
					kind: "repo",
				};

				return (
					<CommandLinkItem
						key={repo.repositoryId}
						value={`${repo.fullName} ${repo.ownerLogin} ${repo.name}`}
						href={target.path}
						onBeforeNavigate={() => onSelect(target)}
					>
						<IconForKind kind="repo" />
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm">{repo.fullName}</div>
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								{repo.failingCheckCount > 0 && (
									<span className="text-destructive">
										{repo.failingCheckCount} failing checks
									</span>
								)}
							</div>
						</div>
						<span className="text-xs text-muted-foreground">
							{formatRelative(repo.updatedAt)}
						</span>
					</CommandLinkItem>
				);
			})}
		</CommandGroup>
	);
}

function RecentNavigation({
	entries,
	onSelect,
}: {
	entries: ReadonlyArray<RecentEntry>;
	onSelect: (target: NavigationTarget) => void;
}) {
	if (entries.length === 0) return null;

	return (
		<CommandGroup heading="Recent">
			{entries.map((entry) => (
				<CommandLinkItem
					key={entry.path}
					value={`${entry.title} ${entry.subtitle ?? ""}`}
					href={entry.path}
					onBeforeNavigate={() =>
						onSelect({
							path: entry.path,
							title: entry.title,
							subtitle: entry.subtitle,
							kind: entry.kind,
						})
					}
				>
					<IconForKind kind={entry.kind === "recent" ? "repo" : entry.kind} />
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm">{entry.title}</div>
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							{entry.subtitle !== null && (
								<span className="truncate">{entry.subtitle}</span>
							)}
							<span>{formatRelative(entry.updatedAt)}</span>
						</div>
					</div>
				</CommandLinkItem>
			))}
		</CommandGroup>
	);
}

function SearchHints() {
	return (
		<CommandGroup heading="Hints">
			<CommandItem value="hint pr123">
				<Search className="size-4 text-muted-foreground" />
				<span>Type `pr 123` to jump directly</span>
			</CommandItem>
			<CommandItem value="hint issue123">
				<Search className="size-4 text-muted-foreground" />
				<span>Type `issue 45` or `#45` to jump</span>
			</CommandItem>
			<CommandItem value="hint dsl1">
				<Search className="size-4 text-muted-foreground" />
				<span>Try `issues by elliot label bug`</span>
			</CommandItem>
			<CommandItem value="hint dsl2">
				<Search className="size-4 text-muted-foreground" />
				<span>Try `prs assigned to elliot in owner/repo last week`</span>
			</CommandItem>
			<CommandItem value="hint cmdk">
				<Search className="size-4 text-muted-foreground" />
				<span>Open this palette anytime</span>
				<CommandShortcut>cmd+k</CommandShortcut>
			</CommandItem>
		</CommandGroup>
	);
}

function QueryDslSummary({
	query,
	repo,
}: {
	query: SearchCommandQuery;
	repo: { readonly owner: string; readonly name: string } | null;
}) {
	if (!query.hasDsl) return null;

	const chips = buildQueryChips(query);

	const canonical = buildCanonicalGitHubSearch(query, repo);

	return (
		<CommandGroup heading="Matches">
			<CommandItem
				value={`interpreted ${canonical}`}
				disabled
				className="items-start gap-3 data-[disabled=true]:opacity-100"
			>
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex flex-wrap items-center gap-1.5">
						{chips.map((chip) => (
							<Badge
								key={chip.key}
								variant="outline"
								className="rounded-md border-dashed bg-muted/40 text-[10px]"
							>
								{renderFilterIcon(chip.icon)}
								{chip.label}
							</Badge>
						))}
					</div>
					<div className="truncate font-mono text-[11px] text-muted-foreground">
						{canonical}
					</div>
				</div>
			</CommandItem>
		</CommandGroup>
	);
}

function GlobalQuickViews({
	onSelect,
	onGoToGitHub,
	query,
}: {
	onSelect: (target: NavigationTarget) => void;
	onGoToGitHub: () => void;
	query?: string;
}) {
	const normalizedQuery = query?.trim().toLowerCase() ?? "";
	const queryTokens =
		normalizedQuery.length === 0 ? [] : normalizedQuery.split(/\s+/);

	const matches = (text: string) => {
		if (queryTokens.length === 0) return true;
		const searchable = text.toLowerCase();
		for (const token of queryTokens) {
			if (!searchable.includes(token)) return false;
		}
		return true;
	};

	const showWorkbench = matches("open workbench dashboard home");
	const showNotifications = matches("open notifications inbox queue updates");
	const showGitHub = matches("go to github github.com repo source");

	if (!showWorkbench && !showNotifications && !showGitHub) {
		return null;
	}

	return (
		<CommandGroup heading="Quick Views">
			{showWorkbench && (
				<CommandLinkItem
					value="view workbench"
					href="/"
					onBeforeNavigate={() =>
						onSelect({
							path: "/",
							title: "Workbench",
							subtitle: "Cross-repo attention dashboard",
							kind: "global",
						})
					}
				>
					<Rocket className="size-4 text-muted-foreground" />
					<span>Open Workbench</span>
				</CommandLinkItem>
			)}
			{showNotifications && (
				<CommandLinkItem
					value="view notifications"
					href="/notifications"
					onBeforeNavigate={() =>
						onSelect({
							path: "/notifications",
							title: "Notifications",
							subtitle: "Cross-repo notification queue",
							kind: "global",
						})
					}
				>
					<Inbox className="size-4 text-muted-foreground" />
					<span>Open Notifications</span>
				</CommandLinkItem>
			)}
			{showGitHub && (
				<CommandItem value="go to github github.com" onSelect={onGoToGitHub}>
					<GitHubIcon className="size-4 text-muted-foreground" />
					<span>Go to GitHub</span>
				</CommandItem>
			)}
		</CommandGroup>
	);
}

function isExactGoToGitHubQuery(rawQuery: string): boolean {
	const normalized = rawQuery.trim().toLowerCase().replace(/\s+/g, " ");
	if (normalized.length === 0) return false;

	return (
		normalized === "github" ||
		normalized === "github.com" ||
		normalized === "go github" ||
		normalized === "go to github" ||
		normalized === "open github" ||
		normalized === "go to github.com"
	);
}

export function SearchCommand() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [recent, setRecent] =
		useState<ReadonlyArray<RecentEntry>>(DEFAULT_RECENT);
	const [repoScopeEnabled, setRepoScopeEnabled] = useState(true);
	const [focusedResultId, setFocusedResultId] = useState<string | null>(null);
	const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
	const debouncedQuery = useDebouncedValue(query, 250);
	const repo = useRepoFromPathname();
	const pathname = usePathname();

	useHotkey("Mod+K", (event) => {
		event.preventDefault();
		setOpen((value) => !value);
	});

	useEffect(() => {
		if (typeof window === "undefined") return;
		const onOpen = () => {
			setOpen(true);
		};
		window.addEventListener(OPEN_SEARCH_COMMAND_EVENT, onOpen);
		return () => {
			window.removeEventListener(OPEN_SEARCH_COMMAND_EVENT, onOpen);
		};
	}, []);

	useEffect(() => {
		if (!open) {
			setQuery("");
			setRepoScopeEnabled(true);
			setFocusedResultId(null);
			return;
		}
		setRecent(getRecentEntries());
	}, [open]);

	const handleSelect = useCallback((target: NavigationTarget) => {
		setOpen(false);
		setRecent((current) => {
			const next = upsertRecent(current, target);
			saveRecentEntries(next);
			return next;
		});
	}, []);

	const goToGitHub = useCallback(() => {
		setOpen(false);
		window.location.replace(`https://github.com${pathname}`);
	}, [pathname]);

	const syncFocusedResultFromDom = useCallback(() => {
		if (typeof document === "undefined") return;
		const selected = document.querySelector(
			"[data-slot='command-item'][data-selected='true'][data-result-id]",
		);
		if (selected === null) {
			setFocusedResultId(null);
			return;
		}
		const selectedId = selected.getAttribute("data-result-id");
		setFocusedResultId(selectedId);
	}, []);

	const onResultPointerIntent = useCallback(
		(resultId: string, pointer: { readonly x: number; readonly y: number }) => {
			const previousPointer = lastPointerPositionRef.current;
			if (
				previousPointer !== null &&
				previousPointer.x === pointer.x &&
				previousPointer.y === pointer.y
			) {
				return;
			}
			lastPointerPositionRef.current = { x: pointer.x, y: pointer.y };
			setFocusedResultId(resultId);
		},
		[],
	);

	useEffect(() => {
		if (!open) return;
		const frame = window.requestAnimationFrame(() => {
			syncFocusedResultFromDom();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [open, syncFocusedResultFromDom]);

	const liveTrimmed = query.trim();
	const liveParsedQuery = useMemo(
		() => parseSearchCommandQuery(liveTrimmed),
		[liveTrimmed],
	);
	const keywordSuggestion = useMemo(
		() => getKeywordSuggestion(query, liveParsedQuery),
		[query, liveParsedQuery],
	);

	const trimmed = debouncedQuery.trim();
	const prioritizeGoToGitHub = isExactGoToGitHubQuery(trimmed);
	const parsedQuery = useMemo(
		() => parseSearchCommandQuery(trimmed),
		[trimmed],
	);

	const implicitRepoScope =
		repo !== null &&
		repoScopeEnabled &&
		parsedQuery.repo === null &&
		parsedQuery.org === null;
	const effectiveRepo = parsedQuery.repo ?? (implicitRepoScope ? repo : null);
	const hasRepoScope = effectiveRepo !== null;
	const hasQuery = trimmed.length > 0;
	const repoQueryText = parsedQuery.hasDsl
		? parsedQuery.textTokens.join(" ")
		: trimmed;

	const liveImplicitRepoScope =
		repo !== null &&
		repoScopeEnabled &&
		liveParsedQuery.repo === null &&
		liveParsedQuery.org === null;
	const liveScopeRepo =
		liveParsedQuery.repo ?? (liveImplicitRepoScope ? repo : null);
	const liveScopeOrg = liveScopeRepo === null ? liveParsedQuery.org : null;
	const canClearImplicitScope =
		repo !== null &&
		repoScopeEnabled &&
		liveParsedQuery.repo === null &&
		liveParsedQuery.org === null;

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			title="FasterGH Command Palette"
			description="Navigate, search issues and PRs, and run quick repo actions"
			className="max-w-3xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl"
			commandProps={{ shouldFilter: false, loop: true }}
			showCloseButton={false}
		>
			<CommandInput
				placeholder={
					hasRepoScope && effectiveRepo !== null
						? `Search ${effectiveRepo.owner}/${effectiveRepo.name}...`
						: "Search repositories, then jump into work..."
				}
				value={query}
				onValueChange={(nextQuery) => {
					setQuery(nextQuery);
					window.requestAnimationFrame(() => {
						syncFocusedResultFromDom();
					});
				}}
				leading={
					<ScopeIndicator
						repo={liveScopeRepo}
						org={liveScopeOrg}
						showClearHint={canClearImplicitScope && liveTrimmed.length === 0}
					/>
				}
				trailing={<InputSuggestionHint suggestion={keywordSuggestion} />}
				onKeyDown={(event) => {
					if (event.key === "Tab" && keywordSuggestion !== null) {
						event.preventDefault();
						setQuery(keywordSuggestion.nextValue);
						return;
					}

					if (
						event.key === "Backspace" &&
						liveTrimmed.length === 0 &&
						canClearImplicitScope
					) {
						event.preventDefault();
						setRepoScopeEnabled(false);
					}
				}}
			/>
			<QueryBadgeRail rawQuery={query} />
			<CommandList
				className="max-h-[68vh]"
				onKeyDown={(event) => {
					if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
						return;
					}
					window.requestAnimationFrame(() => {
						syncFocusedResultFromDom();
					});
				}}
			>
				{!hasRepoScope && !hasQuery && (
					<>
						{repo !== null && !repoScopeEnabled && (
							<>
								<CommandGroup heading="Scope">
									<CommandItem
										value={`scope ${repo.owner}/${repo.name}`}
										onSelect={() => {
											setRepoScopeEnabled(true);
										}}
									>
										<FileCode2 className="size-4 text-status-repo" />
										<span>
											Search in {repo.owner}/{repo.name}
										</span>
									</CommandItem>
								</CommandGroup>
								<CommandSeparator />
							</>
						)}
						<GlobalQuickViews
							onSelect={handleSelect}
							onGoToGitHub={goToGitHub}
						/>
						<CommandSeparator />
						<RepoResults
							query=""
							onSelect={handleSelect}
							heading="Recent Repositories"
							limit={8}
						/>
						{recent.length > 0 && (
							<>
								<CommandSeparator />
								<RecentNavigation entries={recent} onSelect={handleSelect} />
							</>
						)}
						<CommandSeparator />
						<SearchHints />
					</>
				)}

				{!hasRepoScope && hasQuery && (
					<>
						{prioritizeGoToGitHub && (
							<GlobalQuickViews
								onSelect={handleSelect}
								onGoToGitHub={goToGitHub}
								query={trimmed}
							/>
						)}
						<QueryDslSummary query={parsedQuery} repo={effectiveRepo} />
						<GlobalWorkResults
							query={repoQueryText.length > 0 ? repoQueryText : trimmed}
							onSelect={handleSelect}
						/>
						<RepoResults
							query={repoQueryText}
							org={parsedQuery.org ?? undefined}
							onSelect={handleSelect}
						/>
						{!prioritizeGoToGitHub && (
							<GlobalQuickViews
								onSelect={handleSelect}
								onGoToGitHub={goToGitHub}
								query={trimmed}
							/>
						)}
					</>
				)}

				{hasRepoScope && !hasQuery && effectiveRepo !== null && (
					<>
						<RepoQuickActions
							repo={effectiveRepo}
							onSelect={handleSelect}
							onGoToGitHub={goToGitHub}
						/>
						{recent.length > 0 && (
							<>
								<CommandSeparator />
								<RecentNavigation entries={recent} onSelect={handleSelect} />
							</>
						)}
						<CommandSeparator />
						<SearchHints />
					</>
				)}

				{hasRepoScope && hasQuery && effectiveRepo !== null && (
					<>
						{prioritizeGoToGitHub && (
							<GlobalQuickViews
								onSelect={handleSelect}
								onGoToGitHub={goToGitHub}
								query={trimmed}
							/>
						)}
						<QueryDslSummary query={parsedQuery} repo={effectiveRepo} />
						<QuickNumberNavigation
							repo={effectiveRepo}
							query={trimmed}
							onSelect={handleSelect}
						/>
						{parsedQuery.target !== "repo" && (
							<SearchResults
								repo={effectiveRepo}
								query={parsedQuery}
								onSelect={handleSelect}
								focusedResultId={focusedResultId}
								onPointerIntent={onResultPointerIntent}
							/>
						)}
						{(parsedQuery.target === "repo" || !parsedQuery.hasDsl) && (
							<>
								<CommandSeparator />
								<RepoResults
									query={repoQueryText}
									org={parsedQuery.org ?? undefined}
									onSelect={handleSelect}
									heading="Matching Repositories"
									limit={6}
								/>
							</>
						)}
						{!prioritizeGoToGitHub && (
							<GlobalQuickViews
								onSelect={handleSelect}
								onGoToGitHub={goToGitHub}
								query={trimmed}
							/>
						)}
					</>
				)}

				<CommandEmpty>
					{hasRepoScope
						? hasQuery
							? "No results found. Try `issues by elliot`, `prs label bug`, or `pr 123`."
							: "Start typing to search pull requests and issues."
						: hasQuery
							? "No repositories found. Try `in owner/repo` for direct issue/PR search."
							: "Start typing to search repositories."}
				</CommandEmpty>
			</CommandList>
		</CommandDialog>
	);
}
