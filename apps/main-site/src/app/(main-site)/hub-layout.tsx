"use client";

import type { Atom } from "@effect-atom/atom";
import {
	RegistryContext,
	Result,
	useAtom,
	useAtomValue,
} from "@effect-atom/atom-react";
import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import { Card, CardContent, CardHeader } from "@packages/ui/components/card";
import { Input } from "@packages/ui/components/input";
import { Link } from "@packages/ui/components/link";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@packages/ui/components/resizable";
import { Separator } from "@packages/ui/components/separator";
import { Skeleton } from "@packages/ui/components/skeleton";
import { Textarea } from "@packages/ui/components/textarea";
import { cn } from "@packages/ui/lib/utils";
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useOnDemandSync } from "@packages/ui/rpc/on-demand-sync";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useRepoOnboard } from "@packages/ui/rpc/repo-onboard";
import { PatchDiff } from "@pierre/diffs/react";
import { Option } from "effect";
import {
	ArrowLeft,
	GitMerge,
	GitPullRequest,
	MessageCircle,
	Play,
	TriangleAlert,
} from "lucide-react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
	useCallback,
	useContext,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { MarkdownBody } from "@/components/markdown-body";

// ==========================================================================
// Types
// ==========================================================================

type RepoOverview = {
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

type PrItem = {
	readonly number: number;
	readonly state: "open" | "closed";
	readonly draft: boolean;
	readonly title: string;
	readonly authorLogin: string | null;
	readonly authorAvatarUrl: string | null;
	readonly headRefName: string;
	readonly baseRefName: string;
	readonly commentCount: number;
	readonly reviewCount: number;
	readonly lastCheckConclusion: string | null;
	readonly githubUpdatedAt: number;
};

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

type PrDetail = {
	readonly repositoryId: number;
	readonly number: number;
	readonly state: "open" | "closed";
	readonly draft: boolean;
	readonly title: string;
	readonly body: string | null;
	readonly authorLogin: string | null;
	readonly authorAvatarUrl: string | null;
	readonly headRefName: string;
	readonly baseRefName: string;
	readonly headSha: string;
	readonly mergedAt: number | null;
	readonly mergeableState: string | null;
	readonly githubUpdatedAt: number;
	readonly checkRuns: readonly {
		readonly name: string;
		readonly status: string;
		readonly conclusion: string | null;
	}[];
	readonly reviews: readonly {
		readonly githubReviewId: number;
		readonly authorLogin: string | null;
		readonly authorAvatarUrl: string | null;
		readonly state: string;
		readonly submittedAt: number | null;
	}[];
	readonly comments: readonly {
		readonly githubCommentId: number;
		readonly authorLogin: string | null;
		readonly authorAvatarUrl: string | null;
		readonly body: string;
		readonly createdAt: number;
	}[];
};

type IssueDetail = {
	readonly repositoryId: number;
	readonly number: number;
	readonly state: "open" | "closed";
	readonly title: string;
	readonly body: string | null;
	readonly authorLogin: string | null;
	readonly authorAvatarUrl: string | null;
	readonly labelNames: readonly string[];
	readonly githubUpdatedAt: number;
	readonly comments: readonly {
		readonly githubCommentId: number;
		readonly authorLogin: string | null;
		readonly authorAvatarUrl: string | null;
		readonly body: string;
		readonly createdAt: number;
	}[];
};

type FilesData = {
	readonly files: readonly {
		readonly filename: string;
		readonly previousFilename: string | null;
		readonly status:
			| "added"
			| "removed"
			| "modified"
			| "renamed"
			| "copied"
			| "changed"
			| "unchanged";
		readonly additions: number;
		readonly deletions: number;
		readonly patch: string | null;
	}[];
};

type Tab = "pulls" | "issues" | "actions";

// ==========================================================================
// Helpers
// ==========================================================================

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

/** Parse route params from pathname */
function useRouteState(): {
	owner: string | null;
	name: string | null;
	tab: Tab;
	itemNumber: number | null;
} {
	const pathname = usePathname();
	const segments = pathname.split("/").filter(Boolean);

	// /{owner}/{name}/pulls/{number}
	// /{owner}/{name}/issues/{number}
	// /{owner}/{name}/pulls
	// /{owner}/{name}/issues
	// /{owner}/{name}
	// /
	if (segments.length >= 2) {
		const owner = segments[0] ?? null;
		const name = segments[1] ?? null;
		const tabSegment = segments[2];
		const tab: Tab =
			tabSegment === "issues"
				? "issues"
				: tabSegment === "actions"
					? "actions"
					: "pulls";
		const numberStr = segments[3];
		const itemNumber = numberStr ? Number.parseInt(numberStr, 10) : null;
		return {
			owner,
			name,
			tab,
			itemNumber:
				itemNumber !== null && !Number.isNaN(itemNumber) ? itemNumber : null,
		};
	}

	return { owner: null, name: null, tab: "pulls", itemNumber: null };
}

// ==========================================================================
// PANEL 1: Repo Sidebar
// ==========================================================================

const EmptyPayload: Record<string, never> = {};

function RepoSidebar({
	activeOwner,
	activeName,
}: {
	activeOwner: string | null;
	activeName: string | null;
}) {
	const client = useProjectionQueries();
	const reposAtom = useMemo(
		() => client.listRepos.subscription(EmptyPayload),
		[client],
	);
	const reposResult = useAtomValue(reposAtom);

	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 p-3 border-b">
				<h2 className="text-sm font-semibold text-foreground">Repositories</h2>
				<AddRepoFormCompact />
			</div>
			<div className="flex-1 overflow-y-auto">
				<div className="p-1">
					{Result.isInitial(reposResult) && <RepoListSkeleton />}

					{(() => {
						const valueOption = Result.value(reposResult);
						if (Option.isNone(valueOption)) return null;
						const repos = valueOption.value;

						if (repos.length === 0) {
							return (
								<p className="px-2 py-4 text-xs text-muted-foreground text-center">
									No repositories connected yet.
								</p>
							);
						}

						return repos.map((repo) => {
							const isActive =
								repo.ownerLogin === activeOwner && repo.name === activeName;
							return (
								<Link
									key={repo.repositoryId}
									href={`/${repo.ownerLogin}/${repo.name}/pulls`}
									className={cn(
										"flex flex-col gap-1 rounded-md px-2.5 py-2 text-sm transition-colors no-underline",
										isActive
											? "bg-accent text-accent-foreground"
											: "text-muted-foreground hover:bg-muted hover:text-foreground",
									)}
								>
									<span className="font-medium text-foreground truncate">
										{repo.fullName}
									</span>
									<div className="flex items-center gap-2 text-[11px]">
										<span>{repo.openPrCount} PRs</span>
										<span>{repo.openIssueCount} issues</span>
										{repo.failingCheckCount > 0 && (
											<span className="text-destructive">
												{repo.failingCheckCount} failing
											</span>
										)}
									</div>
								</Link>
							);
						});
					})()}
				</div>
			</div>
		</div>
	);
}

function AddRepoFormCompact() {
	const onboardClient = useRepoOnboard();
	const [addResult, addRepo] = useAtom(onboardClient.addRepoByUrl.call);
	const inputRef = useRef<HTMLInputElement>(null);
	const isLoading = Result.isWaiting(addResult);

	const errorMessage = (() => {
		const err = Result.error(addResult);
		if (Option.isNone(err)) return null;
		const e = err.value;
		if (typeof e === "object" && e !== null && "_tag" in e) {
			const tag = (e as { _tag: string })._tag;
			switch (tag) {
				case "InvalidRepoUrl":
					return "Invalid URL. Use owner/repo format.";
				case "RepoNotFound":
					return "Repository not found on GitHub.";
				case "AlreadyConnected":
					return "Repository is already connected.";
				case "WebhookSetupFailed":
					return "Added, but webhook setup failed.";
				case "NotAuthenticated":
					return "Please sign in to add a repository.";
				case "RpcDefectError": {
					const defect = (e as { defect: unknown }).defect;
					if (typeof defect === "string" && defect.length > 0) return defect;
					if (
						typeof defect === "object" &&
						defect !== null &&
						"name" in defect
					) {
						const name = String((defect as { name: unknown }).name);
						const message =
							"message" in defect
								? String((defect as { message: unknown }).message)
								: "";
						return message.length > 0
							? `${name}: ${message}`
							: `Server error: ${name}`;
					}
					if (
						typeof defect === "object" &&
						defect !== null &&
						"message" in defect
					) {
						const msg = String((defect as { message: unknown }).message);
						if (msg.length > 0) return msg;
					}
					return "An unexpected error occurred.";
				}
			}
		}
		if (e instanceof Error && e.message.length > 0) return e.message;
		return "Failed to add repository.";
	})();

	const isSuccess =
		Result.isSuccess(addResult) && Option.isSome(Result.value(addResult));

	return (
		<div className="mt-2">
			<form
				className="flex gap-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					const url = inputRef.current?.value.trim();
					if (!url || isLoading) return;
					addRepo({ url });
				}}
			>
				<Input
					ref={inputRef}
					placeholder="owner/repo"
					disabled={isLoading}
					className="h-7 text-xs flex-1"
				/>
				<Button
					type="submit"
					size="sm"
					disabled={isLoading}
					className="h-7 text-xs px-2"
				>
					{isLoading ? "..." : "Add"}
				</Button>
			</form>
			{errorMessage && (
				<p className="mt-1 text-[11px] text-destructive">{errorMessage}</p>
			)}
			{isSuccess && (
				<p className="mt-1 text-[11px] text-green-600">Repository added!</p>
			)}
		</div>
	);
}

function RepoListSkeleton() {
	return (
		<div className="space-y-2 p-2">
			{[1, 2, 3].map((i) => (
				<div key={i} className="space-y-1.5 px-2 py-2">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-3 w-20" />
				</div>
			))}
		</div>
	);
}

// ==========================================================================
// PANEL 2: List Panel (PRs or Issues)
// ==========================================================================

function ListPanel({
	owner,
	name,
	tab,
	activeItemNumber,
}: {
	owner: string;
	name: string;
	tab: Tab;
	activeItemNumber: number | null;
}) {
	return (
		<div className="flex h-full flex-col">
			{/* Tab bar */}
			<div className="shrink-0 border-b">
				<div className="flex items-center justify-between px-3 pt-2 pb-0">
					<span className="text-sm font-semibold text-foreground truncate">
						{owner}/{name}
					</span>
				</div>
				<div className="flex px-1 mt-1">
					<Link
						href={`/${owner}/${name}/pulls`}
						className={cn(
							"flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors no-underline",
							tab === "pulls"
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
							tab === "issues"
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
							tab === "actions"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<Play className="size-3.5" />
						Actions
					</Link>
				</div>
			</div>

			{/* List content */}
			<div className="flex-1 overflow-y-auto">
				{tab === "pulls" ? (
					<PrListPanel
						owner={owner}
						name={name}
						activeNumber={activeItemNumber}
					/>
				) : tab === "issues" ? (
					<IssueListPanel
						owner={owner}
						name={name}
						activeNumber={activeItemNumber}
					/>
				) : (
					<ActionsListPanel
						owner={owner}
						name={name}
						activeRunNumber={activeItemNumber}
					/>
				)}
			</div>
		</div>
	);
}

// --- PR List ---

function PrListPanel({
	owner,
	name,
	activeNumber,
}: {
	owner: string;
	name: string;
	activeNumber: number | null;
}) {
	const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">(
		"open",
	);
	const client = useProjectionQueries();
	const prsAtom = useMemo(
		() =>
			client.listPullRequests.subscription({
				ownerLogin: owner,
				name,
				state: stateFilter === "all" ? undefined : stateFilter,
			}),
		[client, owner, name, stateFilter],
	);
	const prsResult = useAtomValue(prsAtom);

	const prs = (() => {
		const v = Result.value(prsResult);
		if (Option.isSome(v)) return v.value;
		return null;
	})();

	return (
		<div className="p-2">
			{/* Filter buttons */}
			<div className="flex gap-1 mb-2">
				{(["open", "closed", "all"] as const).map((f) => (
					<Button
						key={f}
						variant={stateFilter === f ? "default" : "ghost"}
						size="sm"
						className="h-6 text-[11px] px-2"
						onClick={() => setStateFilter(f)}
					>
						{f === "open" ? "Open" : f === "closed" ? "Closed" : "All"}
					</Button>
				))}
			</div>

			{prs === null && (
				<div className="space-y-2">
					{[1, 2, 3, 4, 5].map((i) => (
						<Skeleton key={i} className="h-12 w-full rounded-md" />
					))}
				</div>
			)}

			{prs !== null && prs.length === 0 && (
				<p className="px-2 py-6 text-xs text-muted-foreground text-center">
					No {stateFilter !== "all" ? stateFilter : ""} pull requests.
				</p>
			)}

			{prs !== null &&
				prs.map((pr) => (
					<Link
						key={pr.number}
						href={`/${owner}/${name}/pulls/${pr.number}`}
						className={cn(
							"flex items-start gap-2 rounded-md px-2.5 py-2 text-sm transition-colors no-underline",
							activeNumber === pr.number
								? "bg-accent text-accent-foreground"
								: "hover:bg-muted",
						)}
					>
						<PrStateIcon state={pr.state} draft={pr.draft} />
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-1.5">
								<span className="font-medium text-xs truncate">{pr.title}</span>
								{pr.draft && (
									<Badge variant="outline" className="text-[9px] px-1 py-0">
										Draft
									</Badge>
								)}
							</div>
							<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
								<span>#{pr.number}</span>
								{pr.authorLogin && <span>{pr.authorLogin}</span>}
								<span>{formatRelative(pr.githubUpdatedAt)}</span>
								{pr.commentCount > 0 && (
									<span className="flex items-center gap-0.5">
										<MessageCircle className="size-3" />
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
	);
}

// --- Issue List ---

function IssueListPanel({
	owner,
	name,
	activeNumber,
}: {
	owner: string;
	name: string;
	activeNumber: number | null;
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
	const issuesResult = useAtomValue(issuesAtom);

	const issues = (() => {
		const v = Result.value(issuesResult);
		if (Option.isSome(v)) return v.value;
		return null;
	})();

	return (
		<div className="p-2">
			{/* Filter buttons */}
			<div className="flex gap-1 mb-2">
				{(["open", "closed", "all"] as const).map((f) => (
					<Button
						key={f}
						variant={stateFilter === f ? "default" : "ghost"}
						size="sm"
						className="h-6 text-[11px] px-2"
						onClick={() => setStateFilter(f)}
					>
						{f === "open" ? "Open" : f === "closed" ? "Closed" : "All"}
					</Button>
				))}
			</div>

			{issues === null && (
				<div className="space-y-2">
					{[1, 2, 3, 4, 5].map((i) => (
						<Skeleton key={i} className="h-12 w-full rounded-md" />
					))}
				</div>
			)}

			{issues !== null && issues.length === 0 && (
				<p className="px-2 py-6 text-xs text-muted-foreground text-center">
					No {stateFilter !== "all" ? stateFilter : ""} issues.
				</p>
			)}

			{issues !== null &&
				issues.map((issue) => (
					<Link
						key={issue.number}
						href={`/${owner}/${name}/issues/${issue.number}`}
						className={cn(
							"flex items-start gap-2 rounded-md px-2.5 py-2 text-sm transition-colors no-underline",
							activeNumber === issue.number
								? "bg-accent text-accent-foreground"
								: "hover:bg-muted",
						)}
					>
						<IssueStateIcon state={issue.state} />
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-1.5">
								<span className="font-medium text-xs truncate">
									{issue.title}
								</span>
							</div>
							<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
								<span>#{issue.number}</span>
								{issue.authorLogin && <span>{issue.authorLogin}</span>}
								<span>{formatRelative(issue.githubUpdatedAt)}</span>
								{issue.commentCount > 0 && (
									<span className="flex items-center gap-0.5">
										<MessageCircle className="size-3" />
										{issue.commentCount}
									</span>
								)}
							</div>
						</div>
					</Link>
				))}
		</div>
	);
}

// --- Actions List ---

function ActionsListPanel({
	owner,
	name,
	activeRunNumber,
}: {
	owner: string;
	name: string;
	activeRunNumber: number | null;
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
	const runsResult = useAtomValue(runsAtom);

	const runs = (() => {
		const v = Result.value(runsResult);
		if (Option.isSome(v)) return v.value;
		return null;
	})();

	return (
		<div className="p-2">
			{runs === null && (
				<div className="space-y-2">
					{[1, 2, 3, 4, 5].map((i) => (
						<Skeleton key={i} className="h-12 w-full rounded-md" />
					))}
				</div>
			)}

			{runs !== null && runs.length === 0 && (
				<p className="px-2 py-6 text-xs text-muted-foreground text-center">
					No workflow runs found.
				</p>
			)}

			{runs !== null &&
				runs.map((run) => (
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
						<WorkflowConclusionDot
							status={run.status}
							conclusion={run.conclusion}
						/>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-1.5">
								<span className="font-medium text-xs truncate">
									{run.workflowName ?? "Workflow"}
								</span>
							</div>
							<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
								<span>#{run.runNumber}</span>
								{run.actorLogin && <span>{run.actorLogin}</span>}
								<span>{formatRelative(run.createdAt)}</span>
								{run.jobCount > 0 && (
									<span>
										{run.jobCount} job{run.jobCount !== 1 ? "s" : ""}
									</span>
								)}
							</div>
						</div>
						<WorkflowConclusionBadgeSmall
							status={run.status}
							conclusion={run.conclusion}
						/>
					</Link>
				))}
		</div>
	);
}

// ==========================================================================
// PANEL 3: Content/Detail Panel
// ==========================================================================

function DetailPanel({
	owner,
	name,
	tab,
	itemNumber,
}: {
	owner: string;
	name: string;
	tab: Tab;
	itemNumber: number;
}) {
	return (
		<div className="h-full overflow-y-auto">
			<div className="p-4">
				{tab === "pulls" ? (
					<PrDetailContent owner={owner} name={name} prNumber={itemNumber} />
				) : tab === "issues" ? (
					<IssueDetailContent
						owner={owner}
						name={name}
						issueNumber={itemNumber}
					/>
				) : (
					<WorkflowRunDetailContent
						owner={owner}
						name={name}
						runNumber={itemNumber}
					/>
				)}
			</div>
		</div>
	);
}

// --- PR Detail ---

function PrDetailContent({
	owner,
	name,
	prNumber,
}: {
	owner: string;
	name: string;
	prNumber: number;
}) {
	const client = useProjectionQueries();
	const prAtom = useMemo(
		() =>
			client.getPullRequestDetail.subscription({
				ownerLogin: owner,
				name,
				number: prNumber,
			}),
		[client, owner, name, prNumber],
	);
	const prResult = useAtomValue(prAtom);

	const pr = (() => {
		const v = Result.value(prResult);
		if (Option.isSome(v)) return v.value;
		return null;
	})();

	if (Result.isInitial(prResult)) {
		return <DetailSkeleton />;
	}

	if (pr === null) {
		return (
			<SyncFromGitHub
				owner={owner}
				name={name}
				number={prNumber}
				entityType="pull_request"
			/>
		);
	}

	return (
		<>
			{/* Header */}
			<div className="flex items-start gap-2">
				<PrStateIconLarge state={pr.state} draft={pr.draft} />
				<div className="min-w-0 flex-1">
					<h1 className="text-lg font-bold break-words leading-tight">
						{pr.title}
					</h1>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						<span>#{pr.number}</span>
						<PrStateBadge
							state={pr.state}
							draft={pr.draft}
							mergedAt={pr.mergedAt}
						/>
						{pr.authorLogin && (
							<span className="flex items-center gap-1">
								<Avatar className="size-4">
									<AvatarImage src={pr.authorAvatarUrl ?? undefined} />
									<AvatarFallback className="text-[8px]">
										{pr.authorLogin[0]?.toUpperCase()}
									</AvatarFallback>
								</Avatar>
								{pr.authorLogin}
							</span>
						)}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						<code className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">
							{pr.headRefName}
						</code>
						{" \u2192 "}
						<code className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">
							{pr.baseRefName}
						</code>
					</div>
				</div>
			</div>

			{/* Metadata */}
			<div className="mt-3 flex flex-wrap gap-1.5">
				{pr.mergeableState && <MergeableStateBadge state={pr.mergeableState} />}
				<Badge variant="outline" className="text-[10px] font-mono">
					{pr.headSha.slice(0, 7)}
				</Badge>
				<span className="text-xs text-muted-foreground">
					Updated {formatRelative(pr.githubUpdatedAt)}
				</span>
			</div>

			{/* Body */}
			{pr.body && (
				<Card className="mt-4">
					<CardContent className="px-3 pt-3">
						<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-sm">
							<MarkdownBody>{pr.body}</MarkdownBody>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Action bar */}
			<PrActionBar
				ownerLogin={owner}
				name={name}
				number={prNumber}
				repositoryId={pr.repositoryId}
				state={pr.state}
				draft={pr.draft}
				mergedAt={pr.mergedAt}
				mergeableState={pr.mergeableState}
			/>

			{/* Check runs */}
			{pr.checkRuns.length > 0 && (
				<div className="mt-5">
					<h2 className="text-sm font-semibold mb-2">
						Checks ({pr.checkRuns.length})
					</h2>
					<div className="divide-y rounded-md border">
						{pr.checkRuns.map((check) => (
							<div
								key={check.name}
								className="flex items-center justify-between gap-2 px-3 py-1.5"
							>
								<div className="flex items-center gap-2 min-w-0">
									<CheckIcon
										status={check.status}
										conclusion={check.conclusion}
									/>
									<span className="text-xs font-medium truncate">
										{check.name}
									</span>
								</div>
								{check.conclusion && (
									<Badge
										variant={
											check.conclusion === "success"
												? "secondary"
												: check.conclusion === "failure"
													? "destructive"
													: "outline"
										}
										className={cn(
											"shrink-0 text-[10px]",
											check.conclusion === "success" && "text-green-600",
										)}
									>
										{check.conclusion}
									</Badge>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{/* Reviews */}
			{pr.reviews.length > 0 && (
				<div className="mt-5">
					<h2 className="text-sm font-semibold mb-2">
						Reviews ({pr.reviews.length})
					</h2>
					<div className="space-y-1.5">
						{pr.reviews.map((review) => (
							<div
								key={review.githubReviewId}
								className="flex items-center gap-2 rounded-md border px-3 py-2"
							>
								{review.authorLogin && (
									<Avatar className="size-5">
										<AvatarImage src={review.authorAvatarUrl ?? undefined} />
										<AvatarFallback className="text-[8px]">
											{review.authorLogin[0]?.toUpperCase()}
										</AvatarFallback>
									</Avatar>
								)}
								<span className="text-xs font-medium truncate">
									{review.authorLogin ?? "Unknown"}
								</span>
								<ReviewStateBadge state={review.state} />
								{review.submittedAt && (
									<span className="text-[10px] text-muted-foreground ml-auto">
										{formatRelative(review.submittedAt)}
									</span>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{/* Comments */}
			{pr.comments.length > 0 && (
				<div className="mt-5">
					<h2 className="text-sm font-semibold mb-2">
						{pr.comments.length} Comment{pr.comments.length !== 1 ? "s" : ""}
					</h2>
					<div className="space-y-3">
						{pr.comments.map((comment) => (
							<Card key={comment.githubCommentId}>
								<CardHeader className="px-3 pb-1">
									<div className="flex items-center gap-1.5 text-xs">
										{comment.authorLogin && (
											<span className="flex items-center gap-1">
												<Avatar className="size-4">
													<AvatarImage
														src={comment.authorAvatarUrl ?? undefined}
													/>
													<AvatarFallback className="text-[8px]">
														{comment.authorLogin[0]?.toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<span className="font-medium">
													{comment.authorLogin}
												</span>
											</span>
										)}
										<span className="text-muted-foreground">
											{formatRelative(comment.createdAt)}
										</span>
									</div>
								</CardHeader>
								<CardContent className="px-3 pb-3">
									<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-xs">
										<MarkdownBody>{comment.body}</MarkdownBody>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			)}

			{/* Files Changed */}
			<PrFilesChanged owner={owner} name={name} prNumber={prNumber} />

			{/* Comment form */}
			<Separator className="mt-5" />
			<CommentForm
				ownerLogin={owner}
				name={name}
				number={prNumber}
				repositoryId={pr.repositoryId}
			/>
		</>
	);
}

// --- PR Files Changed ---

function PrFilesChanged({
	owner,
	name,
	prNumber,
}: {
	owner: string;
	name: string;
	prNumber: number;
}) {
	const client = useProjectionQueries();
	const filesAtom = useMemo(
		() =>
			client.listPrFiles.subscription({
				ownerLogin: owner,
				name,
				number: prNumber,
			}),
		[client, owner, name, prNumber],
	);
	const filesResult = useAtomValue(filesAtom);

	const filesData = (() => {
		const v = Result.value(filesResult);
		if (Option.isSome(v)) return v.value;
		return null;
	})();

	if (filesData === null) return null;

	const files = filesData.files;
	if (files.length === 0) return null;

	const filePatchEntries = files
		.filter((f) => f.patch !== null)
		.map((file) => {
			const oldName = file.previousFilename ?? file.filename;
			const singlePatch = [
				`diff --git a/${oldName} b/${file.filename}`,
				`--- a/${oldName}`,
				`+++ b/${file.filename}`,
				file.patch,
			].join("\n");
			return {
				filename: file.filename,
				patch: singlePatch,
				status: file.status,
				additions: file.additions,
				deletions: file.deletions,
			};
		});

	const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
	const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

	return (
		<div className="mt-5">
			<h2 className="text-sm font-semibold mb-2">
				Files Changed
				<span className="ml-2 text-xs font-normal text-muted-foreground">
					{files.length} file{files.length !== 1 ? "s" : ""}
					{totalAdditions > 0 && (
						<span className="text-green-600 ml-1">+{totalAdditions}</span>
					)}
					{totalDeletions > 0 && (
						<span className="text-red-600 ml-1">-{totalDeletions}</span>
					)}
				</span>
			</h2>

			{filePatchEntries.length > 0 && (
				<div className="space-y-2">
					{filePatchEntries.map((entry) => (
						<div key={entry.filename} className="min-w-0">
							<div className="flex items-center gap-2 px-2 py-1 bg-muted/50 rounded-t-md border border-b-0 text-[10px]">
								<FileStatusBadge status={entry.status} />
								<span className="font-mono font-medium truncate min-w-0">
									{entry.filename}
								</span>
								<span className="ml-auto flex gap-1.5 shrink-0">
									<span className="text-green-600">+{entry.additions}</span>
									<span className="text-red-600">-{entry.deletions}</span>
								</span>
							</div>
							<div className="overflow-x-auto rounded-b-md border">
								<PatchDiff
									patch={entry.patch}
									options={{ diffStyle: "unified" }}
								/>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// --- Issue Detail ---

function IssueDetailContent({
	owner,
	name,
	issueNumber,
}: {
	owner: string;
	name: string;
	issueNumber: number;
}) {
	const client = useProjectionQueries();
	const issueAtom = useMemo(
		() =>
			client.getIssueDetail.subscription({
				ownerLogin: owner,
				name,
				number: issueNumber,
			}),
		[client, owner, name, issueNumber],
	);
	const issueResult = useAtomValue(issueAtom);

	const issue = (() => {
		const v = Result.value(issueResult);
		if (Option.isSome(v)) return v.value;
		return null;
	})();

	if (Result.isInitial(issueResult)) {
		return <DetailSkeleton />;
	}

	if (issue === null) {
		return (
			<SyncFromGitHub
				owner={owner}
				name={name}
				number={issueNumber}
				entityType="issue"
			/>
		);
	}

	return (
		<>
			{/* Header */}
			<div className="flex items-start gap-2">
				<IssueStateIconLarge state={issue.state} />
				<div className="min-w-0 flex-1">
					<h1 className="text-lg font-bold break-words leading-tight">
						{issue.title}
					</h1>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						<span>#{issue.number}</span>
						<Badge
							variant={issue.state === "open" ? "default" : "secondary"}
							className={cn(
								"text-[10px]",
								issue.state === "open" && "bg-green-600 hover:bg-green-700",
							)}
						>
							{issue.state === "open" ? "Open" : "Closed"}
						</Badge>
						{issue.authorLogin && (
							<span className="flex items-center gap-1">
								<Avatar className="size-4">
									<AvatarImage src={issue.authorAvatarUrl ?? undefined} />
									<AvatarFallback className="text-[8px]">
										{issue.authorLogin[0]?.toUpperCase()}
									</AvatarFallback>
								</Avatar>
								{issue.authorLogin}
							</span>
						)}
					</div>
					{issue.labelNames.length > 0 && (
						<div className="mt-1.5 flex flex-wrap gap-1">
							{issue.labelNames.map((label) => (
								<Badge key={label} variant="outline" className="text-[10px]">
									{label}
								</Badge>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Body */}
			{issue.body && (
				<Card className="mt-4">
					<CardContent className="px-3 pt-3">
						<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-sm">
							<MarkdownBody>{issue.body}</MarkdownBody>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Action bar */}
			<IssueActionBar
				ownerLogin={owner}
				name={name}
				number={issueNumber}
				repositoryId={issue.repositoryId}
				state={issue.state}
			/>

			{/* Comments */}
			{issue.comments.length > 0 && (
				<div className="mt-5">
					<h2 className="text-sm font-semibold mb-2">
						{issue.comments.length} Comment
						{issue.comments.length !== 1 ? "s" : ""}
					</h2>
					<div className="space-y-3">
						{issue.comments.map((comment) => (
							<Card key={comment.githubCommentId}>
								<CardHeader className="px-3 pb-1">
									<div className="flex items-center gap-1.5 text-xs">
										{comment.authorLogin && (
											<span className="flex items-center gap-1">
												<Avatar className="size-4">
													<AvatarImage
														src={comment.authorAvatarUrl ?? undefined}
													/>
													<AvatarFallback className="text-[8px]">
														{comment.authorLogin[0]?.toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<span className="font-medium">
													{comment.authorLogin}
												</span>
											</span>
										)}
										<span className="text-muted-foreground">
											{formatRelative(comment.createdAt)}
										</span>
									</div>
								</CardHeader>
								<CardContent className="px-3 pb-3">
									<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-xs">
										<MarkdownBody>{comment.body}</MarkdownBody>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			)}

			{issue.comments.length === 0 && (
				<p className="mt-4 text-xs text-muted-foreground">No comments yet.</p>
			)}

			{/* Comment form */}
			<Separator className="mt-5" />
			<CommentForm
				ownerLogin={owner}
				name={name}
				number={issueNumber}
				repositoryId={issue.repositoryId}
			/>
		</>
	);
}

// --- Workflow Run Detail ---

type WorkflowJob = {
	readonly githubJobId: number;
	readonly name: string;
	readonly status: string;
	readonly conclusion: string | null;
	readonly startedAt: number | null;
	readonly completedAt: number | null;
	readonly runnerName: string | null;
	readonly stepsJson: string | null;
};

type WorkflowRunDetail = {
	readonly repositoryId: number;
	readonly githubRunId: number;
	readonly workflowName: string | null;
	readonly runNumber: number;
	readonly runAttempt: number;
	readonly event: string;
	readonly status: string | null;
	readonly conclusion: string | null;
	readonly headBranch: string | null;
	readonly headSha: string;
	readonly actorLogin: string | null;
	readonly actorAvatarUrl: string | null;
	readonly htmlUrl: string | null;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly jobs: readonly WorkflowJob[];
} | null;

function WorkflowRunDetailContent({
	owner,
	name,
	runNumber,
}: {
	owner: string;
	name: string;
	runNumber: number;
}) {
	const client = useProjectionQueries();
	const detailAtom = useMemo(
		() =>
			client.getWorkflowRunDetail.subscription({
				ownerLogin: owner,
				name,
				runNumber,
			}),
		[client, owner, name, runNumber],
	);
	const detailResult = useAtomValue(detailAtom);

	const run = (() => {
		const v = Result.value(detailResult);
		if (Option.isSome(v)) return v.value;
		return null;
	})();

	if (Result.isInitial(detailResult)) {
		return <DetailSkeleton />;
	}

	if (run === null) {
		return (
			<div className="py-8 text-center">
				<h2 className="text-base font-semibold">Run #{runNumber}</h2>
				<p className="mt-1 text-xs text-muted-foreground">
					Workflow run not found.
				</p>
			</div>
		);
	}

	return (
		<>
			{/* Header */}
			<div className="flex items-start gap-2">
				<WorkflowConclusionIconLarge
					status={run.status}
					conclusion={run.conclusion}
				/>
				<div className="min-w-0 flex-1">
					<h1 className="text-lg font-bold break-words leading-tight">
						{run.workflowName ?? "Workflow"}{" "}
						<span className="text-muted-foreground font-normal">
							#{run.runNumber}
						</span>
					</h1>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						<WorkflowConclusionBadge
							status={run.status}
							conclusion={run.conclusion}
						/>
						<Badge variant="outline" className="text-[10px]">
							{run.event}
						</Badge>
						{run.headBranch && (
							<code className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">
								{run.headBranch}
							</code>
						)}
						<Badge variant="outline" className="text-[10px] font-mono">
							{run.headSha.slice(0, 7)}
						</Badge>
						{run.runAttempt > 1 && <span>Attempt #{run.runAttempt}</span>}
					</div>
					<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
						{run.actorLogin && (
							<span className="flex items-center gap-1">
								<Avatar className="size-4">
									<AvatarImage src={run.actorAvatarUrl ?? undefined} />
									<AvatarFallback className="text-[8px]">
										{run.actorLogin[0]?.toUpperCase()}
									</AvatarFallback>
								</Avatar>
								{run.actorLogin}
							</span>
						)}
						<span>{formatRelative(run.createdAt)}</span>
						{run.htmlUrl && (
							<Link
								href={run.htmlUrl}
								className="text-xs underline hover:text-foreground"
								target="_blank"
								rel="noopener noreferrer"
							>
								GitHub
							</Link>
						)}
					</div>
				</div>
			</div>

			{/* Jobs */}
			{run.jobs.length > 0 && (
				<div className="mt-5">
					<h2 className="text-sm font-semibold mb-2">
						Jobs ({run.jobs.length})
					</h2>
					<div className="divide-y rounded-md border">
						{run.jobs.map((job) => {
							const steps = parseStepsJson(job.stepsJson);
							const duration = formatJobDuration(
								job.startedAt,
								job.completedAt,
							);
							return (
								<div key={job.githubJobId} className="px-3 py-2">
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 min-w-0">
											<WorkflowConclusionDot
												status={job.status}
												conclusion={job.conclusion}
											/>
											<span className="text-xs font-medium truncate">
												{job.name}
											</span>
											<WorkflowConclusionBadgeSmall
												status={job.status}
												conclusion={job.conclusion}
											/>
										</div>
										{duration && (
											<span className="text-[10px] text-muted-foreground shrink-0">
												{duration}
											</span>
										)}
									</div>
									{job.runnerName && (
										<p className="text-[10px] text-muted-foreground mt-0.5 ml-5">
											Runner: {job.runnerName}
										</p>
									)}
									{steps.length > 0 && (
										<div className="mt-1.5 ml-5 space-y-0.5">
											{steps.map((step, i) => (
												<div
													key={`${step.name}-${i}`}
													className="flex items-center gap-1.5 text-[11px]"
												>
													<StepDot conclusion={step.conclusion} />
													<span className="truncate text-muted-foreground">
														{step.name}
													</span>
													{step.conclusion && step.conclusion !== "success" && (
														<Badge
															variant="outline"
															className="text-[9px] ml-auto"
														>
															{step.conclusion}
														</Badge>
													)}
												</div>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{run.jobs.length === 0 && (
				<p className="mt-4 text-xs text-muted-foreground">
					No jobs found for this workflow run.
				</p>
			)}
		</>
	);
}

// --- Workflow step parsing ---

type WorkflowStep = {
	name: string;
	status: string;
	conclusion: string | null;
	number: number;
};

function parseStepsJson(stepsJson: string | null): readonly WorkflowStep[] {
	if (!stepsJson) return [];
	try {
		const parsed: unknown = JSON.parse(stepsJson);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((s: unknown) => {
				if (typeof s !== "object" || s === null) return null;
				const step = s as Record<string, unknown>;
				const stepName =
					typeof step.name === "string" ? step.name : "Unknown step";
				const status =
					typeof step.status === "string" ? step.status : "unknown";
				const conclusion =
					typeof step.conclusion === "string" ? step.conclusion : null;
				const number = typeof step.number === "number" ? step.number : 0;
				return { name: stepName, status, conclusion, number };
			})
			.filter((s): s is WorkflowStep => s !== null);
	} catch {
		return [];
	}
}

function formatJobDuration(
	startedAt: number | null,
	completedAt: number | null,
): string | null {
	if (startedAt === null || completedAt === null) return null;
	const durationMs = completedAt - startedAt;
	if (durationMs < 1000) return "<1s";
	const seconds = Math.floor(durationMs / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

// ==========================================================================
// Shared components
// ==========================================================================

function SyncFromGitHub({
	owner,
	name,
	number,
	entityType,
}: {
	owner: string;
	name: string;
	number: number;
	entityType: "pull_request" | "issue";
}) {
	const syncClient = useOnDemandSync();
	const syncAtom =
		entityType === "pull_request"
			? syncClient.syncPullRequest.call
			: syncClient.syncIssue.call;
	const [syncResult, triggerSync] = useAtom(syncAtom);

	const isSyncing = Result.isWaiting(syncResult);
	const hasFailed = Result.isFailure(syncResult);
	const hasSucceeded = Result.isSuccess(syncResult);

	return (
		<div className="py-8 text-center">
			<h2 className="text-base font-semibold">
				{entityType === "pull_request" ? "Pull Request" : "Issue"} #{number}
			</h2>
			<p className="mt-1 text-xs text-muted-foreground">Not synced yet.</p>
			<div className="mt-3">
				{!hasSucceeded && (
					<Button
						size="sm"
						onClick={() => {
							triggerSync({ ownerLogin: owner, name, number });
						}}
						disabled={isSyncing}
					>
						{isSyncing ? "Syncing..." : "Sync from GitHub"}
					</Button>
				)}
				{hasSucceeded && (
					<p className="text-xs text-muted-foreground">
						Sync complete. Data will appear momentarily...
					</p>
				)}
				{hasFailed && (
					<p className="mt-1 text-xs text-destructive">
						Failed to sync. The item may not exist or the repo may be private.
					</p>
				)}
			</div>
		</div>
	);
}

function CommentForm({
	ownerLogin,
	name,
	number,
	repositoryId,
}: {
	ownerLogin: string;
	name: string;
	number: number;
	repositoryId: number;
}) {
	const writeClient = useGithubWrite();
	const [commentResult, submitComment] = useAtom(
		writeClient.createComment.mutate,
	);
	const [body, setBody] = useState("");
	const correlationPrefix = useId();
	const isSubmitting = Result.isWaiting(commentResult);

	return (
		<div className="mt-4">
			<h3 className="text-xs font-semibold mb-1.5">Add a comment</h3>
			<Textarea
				placeholder="Leave a comment..."
				value={body}
				onChange={(e) => setBody(e.target.value)}
				rows={3}
				disabled={isSubmitting}
				className="mb-2 text-sm"
			/>
			<div className="flex items-center justify-between">
				<div>
					{Result.isFailure(commentResult) && (
						<p className="text-xs text-destructive">Failed to submit.</p>
					)}
					{Result.isSuccess(commentResult) && body === "" && (
						<p className="text-xs text-green-600">Submitted!</p>
					)}
				</div>
				<Button
					size="sm"
					disabled={body.trim().length === 0 || isSubmitting}
					onClick={() => {
						submitComment({
							correlationId: `${correlationPrefix}-comment-${Date.now()}`,
							ownerLogin,
							name,
							repositoryId,
							number,
							body: body.trim(),
						});
						setBody("");
					}}
				>
					{isSubmitting ? "Submitting..." : "Comment"}
				</Button>
			</div>
		</div>
	);
}

function PrActionBar({
	ownerLogin,
	name,
	number,
	repositoryId,
	state,
	draft,
	mergedAt,
	mergeableState,
}: {
	ownerLogin: string;
	name: string;
	number: number;
	repositoryId: number;
	state: "open" | "closed";
	draft: boolean;
	mergedAt: number | null;
	mergeableState: string | null;
}) {
	const writeClient = useGithubWrite();
	const [mergeResult, doMerge] = useAtom(writeClient.mergePullRequest.mutate);
	const [stateResult, doUpdateState] = useAtom(
		writeClient.updateIssueState.mutate,
	);
	const correlationPrefix = useId();
	const isMerging = Result.isWaiting(mergeResult);
	const isUpdatingState = Result.isWaiting(stateResult);

	if (mergedAt !== null) return null;

	const isMergeable =
		state === "open" &&
		!draft &&
		(mergeableState === "clean" || mergeableState === "unstable");

	return (
		<div className="mt-3 flex flex-wrap items-center gap-2">
			{state === "open" && (
				<Button
					size="sm"
					disabled={!isMergeable || isMerging}
					onClick={() => {
						doMerge({
							correlationId: `${correlationPrefix}-merge-${Date.now()}`,
							ownerLogin,
							name,
							repositoryId,
							number,
						});
					}}
					className={cn(
						"h-7 text-xs",
						isMergeable && "bg-green-600 hover:bg-green-700 text-white",
					)}
				>
					{isMerging ? "Merging..." : "Merge"}
				</Button>
			)}
			{state === "open" && (
				<Button
					variant="outline"
					size="sm"
					disabled={isUpdatingState}
					className="h-7 text-xs"
					onClick={() => {
						doUpdateState({
							correlationId: `${correlationPrefix}-close-${Date.now()}`,
							ownerLogin,
							name,
							repositoryId,
							number,
							state: "closed",
						});
					}}
				>
					{isUpdatingState ? "Closing..." : "Close"}
				</Button>
			)}
			{state === "closed" && (
				<Button
					variant="outline"
					size="sm"
					disabled={isUpdatingState}
					className="h-7 text-xs"
					onClick={() => {
						doUpdateState({
							correlationId: `${correlationPrefix}-reopen-${Date.now()}`,
							ownerLogin,
							name,
							repositoryId,
							number,
							state: "open",
						});
					}}
				>
					{isUpdatingState ? "Reopening..." : "Reopen"}
				</Button>
			)}
			{Result.isFailure(mergeResult) && (
				<span className="text-xs text-destructive">Merge failed.</span>
			)}
			{Result.isFailure(stateResult) && (
				<span className="text-xs text-destructive">Update failed.</span>
			)}
		</div>
	);
}

function IssueActionBar({
	ownerLogin,
	name,
	number,
	repositoryId,
	state,
}: {
	ownerLogin: string;
	name: string;
	number: number;
	repositoryId: number;
	state: "open" | "closed";
}) {
	const writeClient = useGithubWrite();
	const [stateResult, doUpdateState] = useAtom(
		writeClient.updateIssueState.mutate,
	);
	const correlationPrefix = useId();
	const isUpdating = Result.isWaiting(stateResult);

	return (
		<div className="mt-3 flex flex-wrap items-center gap-2">
			{state === "open" && (
				<Button
					variant="outline"
					size="sm"
					disabled={isUpdating}
					className="h-7 text-xs"
					onClick={() => {
						doUpdateState({
							correlationId: `${correlationPrefix}-close-${Date.now()}`,
							ownerLogin,
							name,
							repositoryId,
							number,
							state: "closed",
						});
					}}
				>
					{isUpdating ? "Closing..." : "Close issue"}
				</Button>
			)}
			{state === "closed" && (
				<Button
					variant="outline"
					size="sm"
					disabled={isUpdating}
					className="h-7 text-xs"
					onClick={() => {
						doUpdateState({
							correlationId: `${correlationPrefix}-reopen-${Date.now()}`,
							ownerLogin,
							name,
							repositoryId,
							number,
							state: "open",
						});
					}}
				>
					{isUpdating ? "Reopening..." : "Reopen issue"}
				</Button>
			)}
			{Result.isFailure(stateResult) && (
				<span className="text-xs text-destructive">Update failed.</span>
			)}
		</div>
	);
}

function DetailSkeleton() {
	return (
		<div className="space-y-3">
			<Skeleton className="h-6 w-3/4" />
			<Skeleton className="h-4 w-1/2" />
			<Skeleton className="h-32 w-full mt-4" />
			<Skeleton className="h-20 w-full" />
		</div>
	);
}

// ==========================================================================
// Icon / Badge helpers
// ==========================================================================

function PrStateIcon({
	state,
	draft,
}: {
	state: "open" | "closed";
	draft: boolean;
}) {
	if (draft)
		return (
			<div className="mt-0.5 size-3.5 rounded-full border-2 border-muted-foreground" />
		);
	if (state === "open")
		return (
			<svg
				className="mt-0.5 size-3.5 text-green-600"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
			</svg>
		);
	return (
		<svg
			className="mt-0.5 size-3.5 text-purple-600"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8-9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
		</svg>
	);
}

function PrStateIconLarge({
	state,
	draft,
}: {
	state: "open" | "closed";
	draft: boolean;
}) {
	if (draft)
		return (
			<div className="mt-1 size-5 rounded-full border-2 border-muted-foreground" />
		);
	if (state === "open")
		return (
			<svg
				className="mt-1 size-5 text-green-600 shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
			</svg>
		);
	return (
		<svg
			className="mt-1 size-5 text-purple-600 shrink-0"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8-9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
		</svg>
	);
}

function IssueStateIcon({ state }: { state: "open" | "closed" }) {
	if (state === "open")
		return (
			<svg
				className="mt-0.5 size-3.5 text-green-600"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
				<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
			</svg>
		);
	return (
		<svg
			className="mt-0.5 size-3.5 text-purple-600"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z" />
			<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z" />
		</svg>
	);
}

function IssueStateIconLarge({ state }: { state: "open" | "closed" }) {
	if (state === "open")
		return (
			<svg
				className="mt-1 size-5 text-green-600 shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
				<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
			</svg>
		);
	return (
		<svg
			className="mt-1 size-5 text-purple-600 shrink-0"
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
		return <div className="size-2 rounded-full bg-green-500 shrink-0" />;
	if (conclusion === "failure")
		return <div className="size-2 rounded-full bg-red-500 shrink-0" />;
	return <div className="size-2 rounded-full bg-yellow-500 shrink-0" />;
}

function CheckIcon({
	status,
	conclusion,
}: {
	status: string;
	conclusion: string | null;
}) {
	if (conclusion === "success")
		return (
			<svg
				className="size-3.5 text-green-600"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
			</svg>
		);
	if (conclusion === "failure")
		return (
			<svg
				className="size-3.5 text-red-600"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
			</svg>
		);
	if (status === "in_progress")
		return (
			<div className="size-3.5 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin" />
		);
	return (
		<div className="size-3.5 rounded-full border-2 border-muted-foreground" />
	);
}

function PrStateBadge({
	state,
	draft,
	mergedAt,
}: {
	state: "open" | "closed";
	draft: boolean;
	mergedAt: number | null;
}) {
	if (mergedAt !== null)
		return (
			<Badge className="bg-purple-600 hover:bg-purple-700 text-[10px]">
				Merged
			</Badge>
		);
	if (draft)
		return (
			<Badge variant="outline" className="text-[10px]">
				Draft
			</Badge>
		);
	if (state === "open")
		return (
			<Badge className="bg-green-600 hover:bg-green-700 text-[10px]">
				Open
			</Badge>
		);
	return (
		<Badge variant="secondary" className="text-[10px]">
			Closed
		</Badge>
	);
}

function MergeableStateBadge({ state }: { state: string }) {
	const config: Record<
		string,
		{
			label: string;
			variant: "secondary" | "destructive" | "outline";
			className?: string;
		}
	> = {
		clean: {
			label: "Ready to merge",
			variant: "secondary",
			className: "text-green-600",
		},
		dirty: { label: "Has conflicts", variant: "destructive" },
		blocked: { label: "Blocked", variant: "outline" },
		unstable: {
			label: "Unstable",
			variant: "outline",
			className: "text-yellow-600",
		},
	};
	const c = config[state] ?? { label: state, variant: "outline" as const };
	return (
		<Badge variant={c.variant} className={cn("text-[10px]", c.className)}>
			{c.label}
		</Badge>
	);
}

function ReviewStateBadge({ state }: { state: string }) {
	const config: Record<
		string,
		{
			label: string;
			variant: "secondary" | "destructive" | "outline";
			className?: string;
		}
	> = {
		APPROVED: {
			label: "Approved",
			variant: "secondary",
			className: "text-green-600",
		},
		CHANGES_REQUESTED: { label: "Changes requested", variant: "destructive" },
		COMMENTED: { label: "Commented", variant: "outline" },
		DISMISSED: {
			label: "Dismissed",
			variant: "outline",
			className: "text-muted-foreground",
		},
		PENDING: { label: "Pending", variant: "outline" },
	};
	const c = config[state] ?? { label: state, variant: "outline" as const };
	return (
		<Badge variant={c.variant} className={cn("text-[10px]", c.className)}>
			{c.label}
		</Badge>
	);
}

function FileStatusBadge({
	status,
}: {
	status:
		| "added"
		| "removed"
		| "modified"
		| "renamed"
		| "copied"
		| "changed"
		| "unchanged";
}) {
	const config: Record<string, { label: string; className: string }> = {
		added: {
			label: "A",
			className:
				"bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
		},
		removed: {
			label: "D",
			className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		},
		modified: {
			label: "M",
			className:
				"bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
		},
		renamed: {
			label: "R",
			className:
				"bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
		},
		copied: {
			label: "C",
			className:
				"bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
		},
		changed: {
			label: "T",
			className:
				"bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
		},
		unchanged: {
			label: "U",
			className:
				"bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
		},
	};
	const c = config[status] ?? { label: "?", className: "bg-gray-100" };
	return (
		<span
			className={`inline-flex items-center justify-center size-4 rounded text-[9px] font-bold ${c.className}`}
		>
			{c.label}
		</span>
	);
}

// --- Workflow conclusion icons/badges ---

function WorkflowConclusionDot({
	status,
	conclusion,
}: {
	status: string | null;
	conclusion: string | null;
}) {
	if (status === "in_progress" || status === "queued")
		return (
			<div className="mt-0.5 size-2.5 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin shrink-0" />
		);
	if (conclusion === "success")
		return (
			<div className="mt-0.5 size-2.5 rounded-full bg-green-500 shrink-0" />
		);
	if (conclusion === "failure")
		return <div className="mt-0.5 size-2.5 rounded-full bg-red-500 shrink-0" />;
	return (
		<div className="mt-0.5 size-2.5 rounded-full bg-muted-foreground shrink-0" />
	);
}

function WorkflowConclusionIconLarge({
	status,
	conclusion,
}: {
	status: string | null;
	conclusion: string | null;
}) {
	if (status === "in_progress" || status === "queued")
		return (
			<div className="mt-1 size-5 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin shrink-0" />
		);
	if (conclusion === "success")
		return (
			<svg
				className="mt-1 size-5 text-green-600 shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z" />
			</svg>
		);
	if (conclusion === "failure")
		return (
			<svg
				className="mt-1 size-5 text-red-600 shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 1 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 1 0-1.06-1.06L8 6.94 6.03 4.97Z" />
			</svg>
		);
	return (
		<svg
			className="mt-1 size-5 text-muted-foreground shrink-0"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16ZM4.5 7.25a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Z" />
		</svg>
	);
}

function WorkflowConclusionBadge({
	status,
	conclusion,
}: {
	status: string | null;
	conclusion: string | null;
}) {
	if (status === "in_progress")
		return (
			<Badge variant="secondary" className="text-[10px] text-yellow-600">
				In Progress
			</Badge>
		);
	if (status === "queued")
		return (
			<Badge variant="outline" className="text-[10px]">
				Queued
			</Badge>
		);
	if (conclusion === "success")
		return (
			<Badge
				variant="secondary"
				className={cn("text-[10px]", "text-green-600")}
			>
				Success
			</Badge>
		);
	if (conclusion === "failure")
		return (
			<Badge variant="destructive" className="text-[10px]">
				Failed
			</Badge>
		);
	if (conclusion === "cancelled")
		return (
			<Badge variant="outline" className="text-[10px]">
				Cancelled
			</Badge>
		);
	if (conclusion)
		return (
			<Badge variant="outline" className="text-[10px]">
				{conclusion}
			</Badge>
		);
	return null;
}

function WorkflowConclusionBadgeSmall({
	status,
	conclusion,
}: {
	status: string | null;
	conclusion: string | null;
}) {
	if (status === "in_progress")
		return <span className="size-2 rounded-full bg-yellow-500 shrink-0" />;
	if (conclusion === "success")
		return <span className="size-2 rounded-full bg-green-500 shrink-0" />;
	if (conclusion === "failure")
		return <span className="size-2 rounded-full bg-red-500 shrink-0" />;
	if (conclusion === "cancelled")
		return (
			<span className="size-2 rounded-full bg-muted-foreground shrink-0" />
		);
	return null;
}

function StepDot({ conclusion }: { conclusion: string | null }) {
	if (conclusion === "success")
		return (
			<svg
				className="size-2.5 text-green-600 shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
			</svg>
		);
	if (conclusion === "failure")
		return (
			<svg
				className="size-2.5 text-red-600 shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
			</svg>
		);
	return (
		<svg
			className="size-2.5 text-muted-foreground shrink-0"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
		</svg>
	);
}

// ==========================================================================
// MAIN LAYOUT — Three-panel resizable
// ==========================================================================

function EmptyDetailPanel() {
	return (
		<div className="flex h-full items-center justify-center">
			<div className="text-center">
				<GitPullRequest className="mx-auto size-10 text-muted-foreground/30" />
				<p className="mt-3 text-sm text-muted-foreground">
					Select an item to view details
				</p>
			</div>
		</div>
	);
}

function EmptyListPanel() {
	return (
		<div className="flex h-full items-center justify-center">
			<div className="text-center">
				<ArrowLeft className="mx-auto size-10 text-muted-foreground/30" />
				<p className="mt-3 text-sm text-muted-foreground">
					Select a repository
				</p>
			</div>
		</div>
	);
}

export function HubLayout() {
	const { owner, name, tab, itemNumber } = useRouteState();

	return (
		<div className="h-dvh w-full">
			{/* Desktop: three-panel resizable */}
			<div className="hidden md:block h-full">
				<ResizablePanelGroup direction="horizontal" className="h-full">
					{/* Panel 1: Repos */}
					<ResizablePanel
						defaultSize={18}
						minSize={14}
						maxSize={30}
						className="border-r"
					>
						<RepoSidebar activeOwner={owner} activeName={name} />
					</ResizablePanel>

					<ResizableHandle />

					{/* Panel 2: List (PRs/Issues) */}
					<ResizablePanel
						defaultSize={28}
						minSize={20}
						maxSize={45}
						className="border-r"
					>
						{owner && name ? (
							<ListPanel
								owner={owner}
								name={name}
								tab={tab}
								activeItemNumber={itemNumber}
							/>
						) : (
							<EmptyListPanel />
						)}
					</ResizablePanel>

					<ResizableHandle />

					{/* Panel 3: Detail/Content */}
					<ResizablePanel defaultSize={54} minSize={30} className="min-w-0">
						{owner && name && itemNumber !== null ? (
							<DetailPanel
								owner={owner}
								name={name}
								tab={tab}
								itemNumber={itemNumber}
							/>
						) : (
							<EmptyDetailPanel />
						)}
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>

			{/* Mobile: stacked view — show deepest active panel */}
			<div className="md:hidden h-full">
				{owner && name && itemNumber !== null ? (
					<div className="flex h-full flex-col">
						<div className="shrink-0 flex items-center gap-2 border-b px-3 py-2">
							<Link
								href={`/${owner}/${name}/${tab}`}
								className="text-xs text-muted-foreground hover:text-foreground no-underline flex items-center gap-1"
							>
								<ArrowLeft className="size-3.5" />
								Back to list
							</Link>
						</div>
						<div className="flex-1 overflow-y-auto">
							<div className="p-3">
								{tab === "pulls" ? (
									<PrDetailContent
										owner={owner}
										name={name}
										prNumber={itemNumber}
									/>
								) : tab === "issues" ? (
									<IssueDetailContent
										owner={owner}
										name={name}
										issueNumber={itemNumber}
									/>
								) : (
									<WorkflowRunDetailContent
										owner={owner}
										name={name}
										runNumber={itemNumber}
									/>
								)}
							</div>
						</div>
					</div>
				) : owner && name ? (
					<div className="flex h-full flex-col">
						<div className="shrink-0 flex items-center gap-2 border-b px-3 py-2">
							<Link
								href="/"
								className="text-xs text-muted-foreground hover:text-foreground no-underline flex items-center gap-1"
							>
								<ArrowLeft className="size-3.5" />
								Repos
							</Link>
							<span className="text-xs font-medium truncate">
								{owner}/{name}
							</span>
						</div>
						<ListPanel
							owner={owner}
							name={name}
							tab={tab}
							activeItemNumber={null}
						/>
					</div>
				) : (
					<RepoSidebar activeOwner={null} activeName={null} />
				)}
			</div>
		</div>
	);
}
