"use client";

import { Result, useAtom } from "@effect-atom/atom-react";
import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import { Input } from "@packages/ui/components/input";
import { Link } from "@packages/ui/components/link";
import { Textarea } from "@packages/ui/components/textarea";
import { useInfinitePaginationWithInitial } from "@packages/ui/hooks/use-paginated-atom";
import { cn } from "@packages/ui/lib/utils";
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
	CheckCircle2,
	CircleDot,
	Loader2,
	MessageCircle,
	Plus,
	Search,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

const PAGE_SIZE = 30;

/** Scroll the issue list item with the given number into view within its scroll container */
function scrollIssueIntoView(issueNumber: number) {
	requestAnimationFrame(() => {
		const el = document.querySelector(`[data-issue-number="${issueNumber}"]`);
		el?.scrollIntoView({ block: "nearest" });
	});
}

type IssueItem = {
	readonly number: number;
	readonly state: "open" | "closed";
	readonly optimisticState: "pending" | "failed" | "confirmed" | null;
	readonly optimisticErrorMessage: string | null;
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
	repositoryId,
	initialData = [],
}: {
	owner: string;
	name: string;
	repositoryId: number | null;
	initialData?: ReadonlyArray<IssueItem>;
}) {
	const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">(
		"open",
	);
	const [isComposerOpen, setIsComposerOpen] = useState(false);
	const [titleFilter, setTitleFilter] = useState("");
	const filterInputId = useId();
	const [newIssueQuery, setNewIssueQuery] = useQueryState(
		"new",
		parseAsString.withDefault(""),
	);

	useEffect(() => {
		if (newIssueQuery !== "1") return;
		setIsComposerOpen(true);
		void setNewIssueQuery(null);
	}, [newIssueQuery, setNewIssueQuery]);

	const client = useProjectionQueries();
	const paginatedAtom = useMemo(
		() =>
			client.listIssuesPaginated.paginated(PAGE_SIZE, {
				ownerLogin: owner,
				name,
				state: stateFilter === "all" ? undefined : stateFilter,
			}),
		[client, owner, name, stateFilter],
	);

	const pagination = useInfinitePaginationWithInitial(
		paginatedAtom,
		initialData,
	);
	const { items: issues, sentinelRef, isLoading } = pagination;

	const normalizedFilter = titleFilter.trim().toLowerCase();
	const filteredIssues = useMemo(
		() =>
			issues.filter((issue) => {
				if (normalizedFilter.length === 0) return true;
				return (
					issue.title.toLowerCase().includes(normalizedFilter) ||
					String(issue.number).includes(normalizedFilter) ||
					(issue.authorLogin?.toLowerCase().includes(normalizedFilter) ??
						false) ||
					issue.labelNames.some((label) =>
						label.toLowerCase().includes(normalizedFilter),
					)
				);
			}),
		[issues, normalizedFilter],
	);

	const pathname = usePathname();
	const router = useRouter();
	const activeNumber = (() => {
		const match = /\/issues\/(\d+)/.exec(pathname);
		return match?.[1] ? Number.parseInt(match[1], 10) : null;
	})();

	const activeIndex = filteredIssues.findIndex(
		(issue) => issue.number === activeNumber,
	);

	const pendingNavRef = useRef<"next" | null>(null);
	const prevCountRef = useRef(filteredIssues.length);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== "/") return;

			const target = event.target;
			if (target instanceof HTMLElement) {
				const tag = target.tagName.toLowerCase();
				if (
					tag === "input" ||
					tag === "textarea" ||
					target.getAttribute("contenteditable") === "true"
				) {
					return;
				}
			}

			event.preventDefault();
			const input = document.getElementById(filterInputId);
			if (input instanceof HTMLInputElement) {
				input.focus();
				input.select();
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [filterInputId]);

	useEffect(() => {
		if (
			filteredIssues.length > prevCountRef.current &&
			pendingNavRef.current === "next"
		) {
			const nextIndex = prevCountRef.current;
			const issue = filteredIssues[nextIndex];
			if (issue) {
				router.push(`/${owner}/${name}/issues/${issue.number}`);
				scrollIssueIntoView(issue.number);
			}
			pendingNavRef.current = null;
		}
		prevCountRef.current = filteredIssues.length;
	}, [filteredIssues.length, filteredIssues, owner, name, router]);

	const navigateTo = useCallback(
		(index: number) => {
			const issue = filteredIssues[index];
			if (!issue) return;
			router.push(`/${owner}/${name}/issues/${issue.number}`);
			scrollIssueIntoView(issue.number);
		},
		[filteredIssues, owner, name, router],
	);

	useHotkey("J", (event) => {
		event.preventDefault();
		if (filteredIssues.length === 0) return;

		if (activeIndex === -1) {
			navigateTo(0);
			return;
		}

		const nextIndex = activeIndex + 1;
		if (nextIndex < filteredIssues.length) {
			navigateTo(nextIndex);
		} else if (pagination.hasMore && normalizedFilter.length === 0) {
			pendingNavRef.current = "next";
			pagination.loadMore();
		}
	});

	useHotkey("K", (event) => {
		event.preventDefault();
		if (filteredIssues.length === 0) return;
		const nextIndex = activeIndex === -1 ? 0 : Math.max(activeIndex - 1, 0);
		navigateTo(nextIndex);
	});

	useHotkey("O", (event) => {
		event.preventDefault();
		if (filteredIssues.length === 0) return;
		const index = activeIndex === -1 ? 0 : activeIndex;
		navigateTo(index);
	});

	return (
		<div className="p-1.5">
			<div className="mb-1.5 px-1">
				<div className="relative">
					<Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
					<Input
						id={filterInputId}
						value={titleFilter}
						onChange={(event) => setTitleFilter(event.target.value)}
						placeholder="Filter issues by title, number, author, label (/ to focus)"
						className="h-7 pl-7 text-[11px]"
					/>
				</div>
			</div>
			<div className="mb-2 px-1">
				<Button
					variant={isComposerOpen ? "default" : "outline"}
					size="sm"
					className="h-7 w-full justify-start gap-1.5 text-[11px]"
					onClick={() => setIsComposerOpen((value) => !value)}
					disabled={repositoryId === null}
				>
					<Plus className="size-3" />
					New issue
				</Button>
			</div>

			{isComposerOpen && repositoryId !== null && (
				<CreateIssueComposer
					owner={owner}
					name={name}
					repositoryId={repositoryId}
					onCreated={() => setIsComposerOpen(false)}
				/>
			)}

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

			{filteredIssues.length === 0 && !isLoading && (
				<p className="px-2 py-8 text-xs text-muted-foreground text-center">
					{normalizedFilter.length > 0
						? "No issues match this filter."
						: `No ${stateFilter !== "all" ? stateFilter : ""} issues.`}
				</p>
			)}

			{filteredIssues.map((issue) => (
				<Link
					key={issue.number}
					data-issue-number={issue.number}
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
							{issue.optimisticState === "pending" && (
								<Badge variant="outline" className="h-4 px-1 text-[9px]">
									Saving...
								</Badge>
							)}
							{issue.optimisticState === "failed" && (
								<Badge variant="destructive" className="h-4 px-1 text-[9px]">
									Write failed
								</Badge>
							)}
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
						{issue.optimisticState === "failed" &&
							issue.optimisticErrorMessage !== null && (
								<p className="mt-1 text-[10px] text-destructive truncate">
									{issue.optimisticErrorMessage}
								</p>
							)}
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

			<div ref={sentinelRef} className="h-1" />
			{isLoading && normalizedFilter.length === 0 && (
				<div className="flex items-center justify-center py-3">
					<Loader2 className="size-4 animate-spin text-muted-foreground" />
				</div>
			)}
		</div>
	);
}

function CreateIssueComposer({
	owner,
	name,
	repositoryId,
	onCreated,
}: {
	owner: string;
	name: string;
	repositoryId: number;
	onCreated: () => void;
}) {
	const writeClient = useGithubWrite();
	const [createIssueResult, createIssue] = useAtom(
		writeClient.createIssue.mutate,
	);
	const correlationPrefix = useId();
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [labelsInput, setLabelsInput] = useState("");

	const isSubmitting = Result.isWaiting(createIssueResult);
	const isSuccess = Result.isSuccess(createIssueResult);

	useEffect(() => {
		if (!isSuccess) return;
		setTitle("");
		setBody("");
		setLabelsInput("");
		onCreated();
	}, [isSuccess, onCreated]);

	const labels = labelsInput
		.split(",")
		.map((label) => label.trim())
		.filter((label) => label.length > 0);

	return (
		<div className="mb-2 rounded-md border border-border/60 bg-muted/20 p-2 space-y-2">
			<Input
				placeholder="Issue title"
				value={title}
				onChange={(event) => setTitle(event.target.value)}
				disabled={isSubmitting}
				className="h-8 text-xs"
			/>
			<Textarea
				placeholder="Describe the issue (optional)"
				value={body}
				onChange={(event) => setBody(event.target.value)}
				disabled={isSubmitting}
				rows={4}
				className="text-xs"
			/>
			<Input
				placeholder="Labels (comma-separated, optional)"
				value={labelsInput}
				onChange={(event) => setLabelsInput(event.target.value)}
				disabled={isSubmitting}
				className="h-8 text-xs"
			/>
			<div className="flex items-center justify-between gap-2">
				{Result.isFailure(createIssueResult) ? (
					<p className="text-[10px] text-destructive">
						Failed to create issue.
					</p>
				) : (
					<span className="text-[10px] text-muted-foreground">
						Creates issue directly on GitHub
					</span>
				)}
				<Button
					size="sm"
					className="h-7 text-[11px]"
					disabled={title.trim().length === 0 || isSubmitting}
					onClick={() => {
						createIssue({
							correlationId: `${correlationPrefix}-create-issue-${Date.now()}`,
							ownerLogin: owner,
							name,
							repositoryId,
							title: title.trim(),
							body: body.trim().length > 0 ? body.trim() : undefined,
							labels: labels.length > 0 ? labels : undefined,
						});
					}}
				>
					{isSubmitting ? "Creating..." : "Create issue"}
				</Button>
			</div>
		</div>
	);
}

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
