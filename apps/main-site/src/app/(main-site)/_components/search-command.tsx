"use client";

import { Result, useAtomValue } from "@effect-atom/atom-react";
import { Badge } from "@packages/ui/components/badge";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@packages/ui/components/command";
import {
	CircleDot,
	Clock3,
	FileCode2,
	GitPullRequest,
	Inbox,
	ListChecks,
	Loader2,
	Rocket,
	Search,
} from "@packages/ui/components/icons";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Option } from "effect";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	buildCanonicalGitHubSearch,
	parseSearchCommandQuery,
	type SearchCommandQuery,
} from "./search-command-dsl";
import {
	buildQueryChips,
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
	readonly lastCheckConclusion: string | null;
	readonly githubUpdatedAt: number;
};

type NavigationKind =
	| "repo"
	| "global"
	| "pr"
	| "issue"
	| "actions"
	| "code"
	| "inbox"
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

const RECENT_KEY = "quickhub.recent.navigation";
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
						entry.kind === "inbox"
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
	if (kind === "inbox") return <Inbox className="size-4" />;
	if (kind === "repo") return <Search className="size-4" />;
	return <Clock3 className="size-4 text-muted-foreground" />;
}

function RepoQuickActions({
	repo,
	onSelect,
}: {
	repo: { readonly owner: string; readonly name: string };
	onSelect: (target: NavigationTarget) => void;
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
			path: `${base}/issues?new=1`,
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
			path: `${base}/code`,
			title: "Browse Code",
			subtitle: `${repo.owner}/${repo.name}`,
			kind: "code",
		},
		{
			path: "/inbox",
			title: "Open Inbox",
			subtitle: "Notifications",
			kind: "inbox",
		},
	];

	return (
		<CommandGroup heading="Quick Actions">
			{actions.map((action) => (
				<CommandItem
					key={action.path}
					value={`${action.title} ${action.subtitle ?? ""}`}
					onSelect={() => onSelect(action)}
				>
					<IconForKind kind={action.kind} />
					<span>{action.title}</span>
					{action.subtitle !== null && (
						<span className="ml-auto text-xs text-muted-foreground truncate max-w-[12rem]">
							{action.subtitle}
						</span>
					)}
				</CommandItem>
			))}
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
			path: `/${repo.owner}/${repo.name}/pulls/${number}`,
			title: `Open Pull Request #${number}`,
			subtitle: `${repo.owner}/${repo.name}`,
			kind: "pr",
		});
	} else {
		paths.push(
			{
				path: `/${repo.owner}/${repo.name}/pulls/${number}`,
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
				<CommandItem
					key={target.path}
					value={`${target.title} ${target.subtitle ?? ""}`}
					onSelect={() => onSelect(target)}
				>
					<IconForKind kind={target.kind} />
					<span>{target.title}</span>
					<CommandShortcut>Enter</CommandShortcut>
				</CommandItem>
			))}
		</CommandGroup>
	);
}

function SearchResultRow({
	item,
	repo,
	onSelect,
}: {
	item: SearchResultItem;
	repo: { readonly owner: string; readonly name: string };
	onSelect: (target: NavigationTarget) => void;
}) {
	const kind: NavigationKind = item.type === "pr" ? "pr" : "issue";
	const segment = item.type === "pr" ? "pulls" : "issues";
	const target: NavigationTarget = {
		path: `/${repo.owner}/${repo.name}/${segment}/${item.number}`,
		title: item.title,
		subtitle: `${item.type === "pr" ? "PR" : "Issue"} #${item.number}`,
		kind,
	};

	return (
		<CommandItem
			value={`${item.type} ${item.number} ${item.title} ${item.authorLogin ?? ""}`}
			onSelect={() => onSelect(target)}
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
		</CommandItem>
	);
}

function SearchResults({
	repo,
	query,
	onSelect,
}: {
	repo: { readonly owner: string; readonly name: string };
	query: SearchCommandQuery;
	onSelect: (target: NavigationTarget) => void;
}) {
	const client = useProjectionQueries();
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

	if (Result.isInitial(result)) {
		return (
			<div className="flex items-center justify-center py-6">
				<Loader2 className="size-4 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const valueOption = Result.value(result);
	if (Option.isNone(valueOption)) return null;

	const items = valueOption.value;
	if (items.length === 0) return null;

	const prs = items.filter((item) => item.type === "pr");
	const issues = items.filter((item) => item.type === "issue");

	return (
		<>
			{prs.length > 0 && (
				<CommandGroup heading="Pull Requests">
					{prs.map((item) => (
						<SearchResultRow
							key={`pr-${item.number}`}
							item={item}
							repo={repo}
							onSelect={onSelect}
						/>
					))}
				</CommandGroup>
			)}
			{issues.length > 0 && (
				<CommandGroup heading="Issues">
					{issues.map((item) => (
						<SearchResultRow
							key={`issue-${item.number}`}
							item={item}
							repo={repo}
							onSelect={onSelect}
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
	const client = useProjectionQueries();
	const dashboardAtom = useMemo(
		() =>
			client.getHomeDashboard.subscription({
				scope: "personal",
				days: 14,
			}),
		[client],
	);
	const result = useAtomValue(dashboardAtom);

	if (Result.isInitial(result)) {
		return (
			<div className="flex items-center justify-center py-4">
				<Loader2 className="size-4 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const valueOption = Result.value(result);
	if (Option.isNone(valueOption)) return null;

	const dashboard = valueOption.value;
	const allItems: Array<DashboardPrItem> = [
		...dashboard.needsAttentionPrs,
		...dashboard.yourPrs,
		...dashboard.recentPrs,
	];

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
		.sort((a, b) => {
			const scoreA =
				(a.lastCheckConclusion === "failure" ? 10 : 0) +
				(a.state === "open" ? 5 : 0) +
				a.githubUpdatedAt;
			const scoreB =
				(b.lastCheckConclusion === "failure" ? 10 : 0) +
				(b.state === "open" ? 5 : 0) +
				b.githubUpdatedAt;
			return scoreB - scoreA;
		})
		.slice(0, 12);

	if (filtered.length === 0) return null;

	return (
		<CommandGroup heading="Priority Work Across Repos">
			{filtered.map((item) => {
				const target: NavigationTarget = {
					path: `/${item.ownerLogin}/${item.repoName}/pulls/${item.number}`,
					title: item.title,
					subtitle: `${item.ownerLogin}/${item.repoName} · PR #${item.number}`,
					kind: "pr",
				};

				return (
					<CommandItem
						key={`${item.ownerLogin}/${item.repoName}#${item.number}`}
						value={`${item.title} ${item.ownerLogin}/${item.repoName} ${item.number}`}
						onSelect={() => onSelect(target)}
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
						{item.lastCheckConclusion === "failure" && (
							<Badge variant="destructive" className="text-[10px]">
								failing
							</Badge>
						)}
					</CommandItem>
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
	const client = useProjectionQueries();
	const reposAtom = useMemo(() => client.listRepos.subscription({}), [client]);
	const result = useAtomValue(reposAtom);

	if (Result.isInitial(result)) {
		return null;
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
					<CommandItem
						key={repo.repositoryId}
						value={`${repo.fullName} ${repo.ownerLogin} ${repo.name}`}
						onSelect={() => onSelect(target)}
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
					</CommandItem>
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
				<CommandItem
					key={entry.path}
					value={`${entry.title} ${entry.subtitle ?? ""}`}
					onSelect={() =>
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
				</CommandItem>
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
}: {
	onSelect: (target: NavigationTarget) => void;
}) {
	return (
		<CommandGroup heading="Quick Views">
			<CommandItem
				value="view workbench"
				onSelect={() =>
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
			</CommandItem>
			<CommandItem
				value="view inbox"
				onSelect={() =>
					onSelect({
						path: "/inbox",
						title: "Inbox",
						subtitle: "Cross-repo notification queue",
						kind: "global",
					})
				}
			>
				<Inbox className="size-4 text-muted-foreground" />
				<span>Open Inbox</span>
			</CommandItem>
		</CommandGroup>
	);
}

export function SearchCommand() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [recent, setRecent] =
		useState<ReadonlyArray<RecentEntry>>(DEFAULT_RECENT);
	const debouncedQuery = useDebouncedValue(query, 250);
	const repo = useRepoFromPathname();
	const router = useRouter();

	useHotkey("Mod+K", (event) => {
		event.preventDefault();
		setOpen((value) => !value);
	});

	useEffect(() => {
		if (!open) {
			setQuery("");
			return;
		}
		setRecent(getRecentEntries());
	}, [open]);

	const handleSelect = useCallback(
		(target: NavigationTarget) => {
			setOpen(false);
			setRecent((current) => {
				const next = upsertRecent(current, target);
				saveRecentEntries(next);
				return next;
			});
			router.push(target.path);
		},
		[router],
	);

	const trimmed = debouncedQuery.trim();
	const parsedQuery = useMemo(
		() => parseSearchCommandQuery(trimmed),
		[trimmed],
	);
	const effectiveRepo = parsedQuery.repo ?? repo;
	const hasRepo = repo !== null;
	const hasQuery = trimmed.length > 0;
	const repoQueryText = parsedQuery.hasDsl
		? parsedQuery.textTokens.join(" ")
		: trimmed;

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			title="QuickHub Command Palette"
			description="Navigate, search issues and PRs, and run quick repo actions"
			commandProps={{ shouldFilter: false }}
			showCloseButton={false}
		>
			<CommandInput
				placeholder={
					hasRepo
						? `Search ${repo.owner}/${repo.name}...`
						: "Search repositories, then jump into work..."
				}
				value={query}
				onValueChange={setQuery}
			/>
			<QueryBadgeRail rawQuery={query} />
			<CommandList>
				{!hasRepo && !hasQuery && (
					<>
						<GlobalQuickViews onSelect={handleSelect} />
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

				{!hasRepo && hasQuery && (
					<>
						<QueryDslSummary query={parsedQuery} repo={effectiveRepo} />
						{parsedQuery.repo !== null && parsedQuery.target !== "repo" ? (
							<SearchResults
								repo={parsedQuery.repo}
								query={parsedQuery}
								onSelect={handleSelect}
							/>
						) : (
							<GlobalWorkResults
								query={repoQueryText.length > 0 ? repoQueryText : trimmed}
								onSelect={handleSelect}
							/>
						)}
						<RepoResults
							query={repoQueryText}
							org={parsedQuery.org ?? undefined}
							onSelect={handleSelect}
						/>
					</>
				)}

				{hasRepo && !hasQuery && (
					<>
						<RepoQuickActions repo={repo} onSelect={handleSelect} />
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

				{hasRepo && hasQuery && (
					<>
						<QueryDslSummary query={parsedQuery} repo={effectiveRepo} />
						<QuickNumberNavigation
							repo={repo}
							query={trimmed}
							onSelect={handleSelect}
						/>
						{parsedQuery.target !== "repo" && (
							<SearchResults
								repo={effectiveRepo ?? repo}
								query={parsedQuery}
								onSelect={handleSelect}
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
					</>
				)}

				<CommandEmpty>
					{hasRepo
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
