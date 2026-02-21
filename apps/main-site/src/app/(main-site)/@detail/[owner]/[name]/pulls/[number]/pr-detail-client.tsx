"use client";

import { Result, useAtom } from "@effect-atom/atom-react";
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
import { Separator } from "@packages/ui/components/separator";
import { Skeleton } from "@packages/ui/components/skeleton";
import { Textarea } from "@packages/ui/components/textarea";
import { cn } from "@packages/ui/lib/utils";
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { PatchDiff } from "@pierre/diffs/react";
import { Option } from "effect";
import { ChevronDown, ExternalLink, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AssigneesCombobox } from "@/app/(main-site)/_components/assignees-combobox";
import { LabelsCombobox } from "@/app/(main-site)/_components/labels-combobox";
import { MarkdownBody } from "@/components/markdown-body";

// ---------------------------------------------------------------------------
// Error extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable error message from an RPC result.
 *
 * GitHubInteractionError has { _tag, status, message }.
 * RpcDefectError has { _tag: "RpcDefectError", defect }.
 * Falls back to the provided default message.
 */
function extractInteractionError(
	result: Result.Result<unknown, unknown>,
	fallback: string,
): string {
	const errOption = Result.error(result);
	if (Option.isNone(errOption)) return fallback;

	const err = errOption.value;
	if (typeof err !== "object" || err === null) return fallback;

	// GitHubInteractionError — has _tag + message
	if ("_tag" in err && "message" in err) {
		const msg = (err as { message: unknown }).message;
		if (typeof msg === "string" && msg.length > 0) return msg;
	}

	// RpcDefectError — has defect with message
	if (
		"_tag" in err &&
		(err as { _tag: unknown })._tag === "RpcDefectError" &&
		"defect" in err
	) {
		const defect = (err as { defect: unknown }).defect;
		if (typeof defect === "string" && defect.length > 0) return defect;
		if (typeof defect === "object" && defect !== null && "message" in defect) {
			const msg = (defect as { message: unknown }).message;
			if (typeof msg === "string" && msg.length > 0) return msg;
		}
	}

	return fallback;
}

type PrDetail = {
	readonly repositoryId: number;
	readonly number: number;
	readonly state: "open" | "closed";
	readonly optimisticOperationType:
		| "update_issue_state"
		| "merge_pull_request"
		| "update_pull_request_branch"
		| "update_labels"
		| "update_assignees"
		| null;
	readonly optimisticState: "pending" | "failed" | "confirmed" | null;
	readonly optimisticErrorMessage: string | null;
	readonly draft: boolean;
	readonly title: string;
	readonly body: string | null;
	readonly authorLogin: string | null;
	readonly authorAvatarUrl: string | null;
	readonly assignees: readonly {
		readonly login: string;
		readonly avatarUrl: string | null;
	}[];
	readonly labelNames: readonly string[];
	readonly headRefName: string;
	readonly baseRefName: string;
	readonly headSha: string;
	readonly mergedAt: number | null;
	readonly mergeableState: string | null;
	readonly githubUpdatedAt: number;
	readonly checkRuns: readonly {
		readonly githubCheckRunId: number;
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
		readonly optimisticState: "pending" | "failed" | "confirmed" | null;
		readonly optimisticErrorMessage: string | null;
	}[];
	readonly comments: readonly {
		readonly githubCommentId: number;
		readonly authorLogin: string | null;
		readonly authorAvatarUrl: string | null;
		readonly body: string;
		readonly createdAt: number;
	}[];
	readonly reviewComments: readonly {
		readonly githubReviewCommentId: number;
		readonly githubReviewId: number | null;
		readonly inReplyToGithubReviewCommentId: number | null;
		readonly authorLogin: string | null;
		readonly authorAvatarUrl: string | null;
		readonly body: string;
		readonly path: string | null;
		readonly line: number | null;
		readonly startLine: number | null;
		readonly side: string | null;
		readonly startSide: string | null;
		readonly htmlUrl: string | null;
		readonly createdAt: number;
		readonly updatedAt: number;
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

type DraftReviewReply = {
	readonly id: string;
	readonly path: string | null;
	readonly line: number | null;
	readonly side: string | null;
	readonly rootAuthorLogin: string | null;
	readonly rootBody: string;
	readonly replyBody: string;
	readonly createdAt: number;
};

export function PrDetailClient({
	owner,
	name,
	prNumber,
	initialPr,
	initialFiles,
}: {
	owner: string;
	name: string;
	prNumber: number;
	initialPr: PrDetail | null;
	initialFiles: FilesData;
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
	const filesAtom = useMemo(
		() =>
			client.listPrFiles.subscription({
				ownerLogin: owner,
				name,
				number: prNumber,
			}),
		[client, owner, name, prNumber],
	);

	const pr = useSubscriptionWithInitial(prAtom, initialPr);
	const filesData = useSubscriptionWithInitial(filesAtom, initialFiles);
	const [reviewDraftReplies, setReviewDraftReplies] = useState<
		ReadonlyArray<DraftReviewReply>
	>([]);
	const reviewDraftStorageKey = `quickhub.review-draft.${owner}.${name}.${String(prNumber)}`;

	useEffect(() => {
		if (typeof window === "undefined") return;
		const raw = window.localStorage.getItem(reviewDraftStorageKey);
		if (raw === null) return;

		try {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return;

			const restored = parsed
				.filter(
					(item) =>
						typeof item === "object" &&
						item !== null &&
						"id" in item &&
						"rootBody" in item &&
						"replyBody" in item &&
						"createdAt" in item,
				)
				.filter(
					(item) =>
						typeof item.id === "string" &&
						typeof item.rootBody === "string" &&
						typeof item.replyBody === "string" &&
						typeof item.createdAt === "number",
				)
				.map((item) => ({
					id: item.id,
					path:
						typeof item.path === "string" || item.path === null
							? item.path
							: null,
					line:
						typeof item.line === "number" || item.line === null
							? item.line
							: null,
					side:
						typeof item.side === "string" || item.side === null
							? item.side
							: null,
					rootAuthorLogin:
						typeof item.rootAuthorLogin === "string" ||
						item.rootAuthorLogin === null
							? item.rootAuthorLogin
							: null,
					rootBody: item.rootBody,
					replyBody: item.replyBody,
					createdAt: item.createdAt,
				}));

			setReviewDraftReplies(restored);
		} catch {
			return;
		}
	}, [reviewDraftStorageKey]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(
			reviewDraftStorageKey,
			JSON.stringify(reviewDraftReplies),
		);
	}, [reviewDraftStorageKey, reviewDraftReplies]);

	// On-demand file sync: if no files are cached, request a background sync once
	const [, requestFileSync] = useAtom(client.requestPrFileSync.mutate);
	const [fileSyncRequested, setFileSyncRequested] = useState(false);
	useEffect(() => {
		if (filesData.files.length === 0 && pr !== null && !fileSyncRequested) {
			setFileSyncRequested(true);
			requestFileSync({ ownerLogin: owner, name, number: prNumber });
		}
	}, [
		filesData.files.length,
		pr,
		owner,
		name,
		prNumber,
		requestFileSync,
		fileSyncRequested,
	]);
	const isSyncingFiles = fileSyncRequested && filesData.files.length === 0;

	const addDraftReply = useCallback(
		(reply: Omit<DraftReviewReply, "id" | "createdAt">) => {
			setReviewDraftReplies((current) => [
				...current,
				{
					id: `${Date.now()}-${current.length + 1}`,
					createdAt: Date.now(),
					...reply,
				},
			]);
		},
		[],
	);

	const removeDraftReply = useCallback((draftReplyId: string) => {
		setReviewDraftReplies((current) =>
			current.filter((reply) => reply.id !== draftReplyId),
		);
	}, []);

	const updateDraftReplyBody = useCallback(
		(draftReplyId: string, nextBody: string) => {
			setReviewDraftReplies((current) =>
				current.map((reply) =>
					reply.id === draftReplyId
						? {
								...reply,
								replyBody: nextBody,
							}
						: reply,
				),
			);
		},
		[],
	);

	const clearDraftReplies = useCallback(() => {
		setReviewDraftReplies([]);
	}, []);

	if (pr === null) {
		return (
			<div className="py-8 text-center">
				<h2 className="text-base font-semibold">PR #{prNumber}</h2>
				<p className="mt-1 text-xs text-muted-foreground">Not synced yet.</p>
			</div>
		);
	}

	return (
		<div className="flex h-full">
			{/* Main area: diff */}
			<div className="flex-1 min-w-0 h-full overflow-y-auto">
				<DiffPanel
					pr={pr}
					filesData={filesData}
					isSyncingFiles={isSyncingFiles}
					owner={owner}
					name={name}
					onAddDraftReply={addDraftReply}
				/>
			</div>

			{/* Right sidebar: description, metadata, reviews, comments */}
			<div className="hidden lg:flex w-80 xl:w-96 shrink-0 border-l border-border/60 h-full flex-col overflow-y-auto bg-muted/20">
				<InfoSidebar
					pr={pr}
					owner={owner}
					name={name}
					prNumber={prNumber}
					reviewDraftReplies={reviewDraftReplies}
					onRemoveDraftReply={removeDraftReply}
					onUpdateDraftReplyBody={updateDraftReplyBody}
					onClearDraftReplies={clearDraftReplies}
				/>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Left: Diff / Files Changed
// ---------------------------------------------------------------------------

function DiffPanel({
	pr,
	filesData,
	isSyncingFiles,
	owner,
	name,
	onAddDraftReply,
}: {
	pr: PrDetail;
	filesData: FilesData;
	isSyncingFiles: boolean;
	owner: string;
	name: string;
	onAddDraftReply: (reply: Omit<DraftReviewReply, "id" | "createdAt">) => void;
}) {
	const files = filesData.files;
	const fileFilterInputId = useId();
	const [fileQuery, setFileQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<
		"all" | "added" | "modified" | "removed" | "renamed"
	>("all");
	const [viewMode, setViewMode] = useState<"split" | "unified">("split");
	const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>(
		{},
	);

	const diffPrefKey = `quickhub.diff.preferences.${owner}.${name}`;

	useEffect(() => {
		if (typeof window === "undefined") return;
		const raw = window.localStorage.getItem(diffPrefKey);
		if (raw === null) return;

		try {
			const parsed = JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null) return;

			if (
				"viewMode" in parsed &&
				(parsed.viewMode === "split" || parsed.viewMode === "unified")
			) {
				setViewMode(parsed.viewMode);
			}

			if (
				"statusFilter" in parsed &&
				(parsed.statusFilter === "all" ||
					parsed.statusFilter === "added" ||
					parsed.statusFilter === "modified" ||
					parsed.statusFilter === "removed" ||
					parsed.statusFilter === "renamed")
			) {
				setStatusFilter(parsed.statusFilter);
			}
		} catch {
			return;
		}
	}, [diffPrefKey]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(
			diffPrefKey,
			JSON.stringify({ viewMode, statusFilter }),
		);
	}, [diffPrefKey, viewMode, statusFilter]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key.toLowerCase() === "d" && event.shiftKey) {
				event.preventDefault();
				setViewMode((current) => (current === "split" ? "unified" : "split"));
			}

			if (event.key.toLowerCase() === "f" && event.shiftKey) {
				event.preventDefault();
				const input = document.getElementById(fileFilterInputId);
				if (input instanceof HTMLInputElement) {
					input.focus();
					input.select();
				}
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [fileFilterInputId]);

	const reviewCommentsByPath = useMemo(() => {
		const grouped: Record<
			string,
			Array<PrDetail["reviewComments"][number]>
		> = {};
		for (const comment of pr.reviewComments) {
			if (comment.path === null) continue;
			const existing = grouped[comment.path] ?? [];
			existing.push(comment);
			grouped[comment.path] = existing;
		}
		return grouped;
	}, [pr.reviewComments]);

	const entries = useMemo(
		() =>
			files.map((file) => {
				const oldName = file.previousFilename ?? file.filename;
				const patch =
					file.patch === null
						? null
						: [
								`diff --git a/${oldName} b/${file.filename}`,
								`--- a/${oldName}`,
								`+++ b/${file.filename}`,
								file.patch,
							].join("\n");

				return {
					filename: file.filename,
					previousFilename: file.previousFilename,
					patch,
					status: file.status,
					additions: file.additions,
					deletions: file.deletions,
					reviewComments: reviewCommentsByPath[file.filename] ?? [],
				};
			}),
		[files, reviewCommentsByPath],
	);

	const normalizedQuery = fileQuery.trim().toLowerCase();
	const filteredEntries = entries.filter((entry) => {
		const statusMatches =
			statusFilter === "all" ? true : entry.status === statusFilter;
		if (!statusMatches) return false;

		if (normalizedQuery.length === 0) return true;

		const filenameMatch = entry.filename
			.toLowerCase()
			.includes(normalizedQuery);
		const previousFilenameMatch =
			entry.previousFilename !== null
				? entry.previousFilename.toLowerCase().includes(normalizedQuery)
				: false;
		return filenameMatch || previousFilenameMatch;
	});

	const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
	const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
	const totalReviewComments = pr.reviewComments.length;
	const [focusedFilename, setFocusedFilename] = useState<string | null>(null);
	const fileAnchorId = useCallback(
		(filename: string) => `file-${filename.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
		[],
	);

	const jumpToFile = useCallback(
		(filename: string) => {
			const target = document.getElementById(fileAnchorId(filename));
			if (target !== null) {
				setFocusedFilename(filename);
				target.scrollIntoView({ block: "start", behavior: "smooth" });
			}
		},
		[fileAnchorId],
	);

	useEffect(() => {
		if (filteredEntries.length === 0) {
			setFocusedFilename(null);
			return;
		}

		if (focusedFilename === null) {
			setFocusedFilename(filteredEntries[0]?.filename ?? null);
			return;
		}

		const stillVisible = filteredEntries.some(
			(entry) => entry.filename === focusedFilename,
		);

		if (!stillVisible) {
			setFocusedFilename(filteredEntries[0]?.filename ?? null);
		}
	}, [filteredEntries, focusedFilename]);

	const moveFocusedFile = useCallback(
		(direction: "next" | "previous") => {
			if (filteredEntries.length === 0) return;

			const currentIndex = filteredEntries.findIndex(
				(entry) => entry.filename === focusedFilename,
			);
			const fallbackIndex = currentIndex === -1 ? 0 : currentIndex;
			const nextIndex =
				direction === "next"
					? Math.min(fallbackIndex + 1, filteredEntries.length - 1)
					: Math.max(fallbackIndex - 1, 0);
			const nextEntry = filteredEntries[nextIndex];
			if (nextEntry !== undefined) {
				jumpToFile(nextEntry.filename);
			}
		},
		[filteredEntries, focusedFilename, jumpToFile],
	);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
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

			if (event.key === "]") {
				event.preventDefault();
				moveFocusedFile("next");
			}

			if (event.key === "[") {
				event.preventDefault();
				moveFocusedFile("previous");
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [moveFocusedFile]);

	const focusedIndex = filteredEntries.findIndex(
		(entry) => entry.filename === focusedFilename,
	);

	function collapseAllVisibleFiles() {
		const nextState: Record<string, boolean> = {};
		for (const entry of filteredEntries) {
			nextState[entry.filename] = true;
		}
		setCollapsedFiles(nextState);
	}

	function expandAllVisibleFiles() {
		setCollapsedFiles({});
	}

	return (
		<div className="p-4">
			{/* Compact header */}
			<div className="flex items-start gap-2.5 mb-3">
				<PrStateIconLarge state={pr.state} draft={pr.draft} />
				<div className="min-w-0 flex-1">
					<h1 className="text-base font-bold break-words leading-snug tracking-tight">
						{pr.title}
					</h1>
					<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						<span className="tabular-nums">#{pr.number}</span>
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
								<span className="font-medium">{pr.authorLogin}</span>
							</span>
						)}
						<span className="text-muted-foreground/40">&middot;</span>
						<span>{formatRelative(pr.githubUpdatedAt)}</span>
					</div>
				</div>
			</div>

			{/* Description visible on small screens (no right sidebar) */}
			<div className="lg:hidden mb-4">
				{pr.body && <CollapsibleDescription body={pr.body} />}
			</div>

			{/* Diff toolbar */}
			<div className="sticky top-0 z-10 mb-3 rounded-md border bg-background/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
				<div className="flex flex-wrap items-center gap-1.5">
					<Button
						variant={viewMode === "split" ? "default" : "outline"}
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={() => setViewMode("split")}
					>
						Split
					</Button>
					<Button
						variant={viewMode === "unified" ? "default" : "outline"}
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={() => setViewMode("unified")}
					>
						Unified
					</Button>

					<div className="h-5 w-px bg-border mx-0.5" />

					<Button
						variant={statusFilter === "all" ? "default" : "outline"}
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={() => setStatusFilter("all")}
					>
						All
					</Button>
					<Button
						variant={statusFilter === "modified" ? "default" : "outline"}
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={() => setStatusFilter("modified")}
					>
						Modified
					</Button>
					<Button
						variant={statusFilter === "added" ? "default" : "outline"}
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={() => setStatusFilter("added")}
					>
						Added
					</Button>
					<Button
						variant={statusFilter === "removed" ? "default" : "outline"}
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={() => setStatusFilter("removed")}
					>
						Removed
					</Button>
					<Button
						variant={statusFilter === "renamed" ? "default" : "outline"}
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={() => setStatusFilter("renamed")}
					>
						Renamed
					</Button>

					<div className="h-5 w-px bg-border mx-0.5" />

					<Button
						variant="outline"
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={collapseAllVisibleFiles}
					>
						Collapse all
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={expandAllVisibleFiles}
					>
						Expand all
					</Button>

					<div className="h-5 w-px bg-border mx-0.5" />

					<Button
						variant="outline"
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={() => moveFocusedFile("previous")}
						disabled={filteredEntries.length === 0}
					>
						Prev [
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 px-2 text-[11px]"
						onClick={() => moveFocusedFile("next")}
						disabled={filteredEntries.length === 0}
					>
						Next ]
					</Button>
					<span className="text-[11px] text-muted-foreground tabular-nums">
						{focusedIndex === -1
							? "0/0"
							: `${focusedIndex + 1}/${filteredEntries.length}`}
					</span>
				</div>

				<div className="mt-2 flex items-center gap-2">
					<div className="relative min-w-0 flex-1">
						<Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							id={fileFilterInputId}
							value={fileQuery}
							onChange={(event) => setFileQuery(event.target.value)}
							placeholder="Filter files (Shift+F)"
							className="h-8 pl-7 text-xs"
						/>
					</div>
					<span className="text-[11px] text-muted-foreground tabular-nums">
						{filteredEntries.length}/{files.length} files
					</span>
					{totalReviewComments > 0 && (
						<Badge variant="outline" className="text-[10px]">
							{totalReviewComments} review comment
							{totalReviewComments === 1 ? "" : "s"}
						</Badge>
					)}
				</div>
			</div>

			{/* Files summary + diffs */}
			{files.length > 0 && (
				<div>
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
					{filteredEntries.length > 1 && (
						<div className="mb-2 rounded-md border bg-muted/10 p-2">
							<p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground/80">
								Jump to file
							</p>
							<div className="flex flex-wrap gap-1">
								{filteredEntries.map((entry) => (
									<button
										key={`jump-${entry.filename}`}
										type="button"
										onClick={() => jumpToFile(entry.filename)}
										className={cn(
											"inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted",
											focusedFilename === entry.filename &&
												"border-foreground/60 bg-accent",
										)}
									>
										<FileStatusBadge status={entry.status} />
										<span className="max-w-56 truncate font-mono">
											{entry.filename}
										</span>
									</button>
								))}
							</div>
						</div>
					)}
					{filteredEntries.length > 0 && (
						<div className="space-y-2">
							{filteredEntries.map((entry) => {
								const reviewThreads = buildReviewThreads(entry.reviewComments);

								return (
									<div
										key={entry.filename}
										id={fileAnchorId(entry.filename)}
										className={cn(
											"min-w-0 rounded-md scroll-mt-24",
											focusedFilename === entry.filename &&
												"ring-1 ring-foreground/20",
										)}
									>
										<div className="flex items-center gap-2 px-2 py-1 bg-muted/50 rounded-t-md border border-b-0 text-[10px]">
											<FileStatusBadge status={entry.status} />
											<button
												type="button"
												onClick={() =>
													setCollapsedFiles((current) => ({
														...current,
														[entry.filename]: !current[entry.filename],
													}))
												}
												className="inline-flex size-5 items-center justify-center rounded hover:bg-muted"
											>
												<ChevronDown
													className={cn(
														"size-3 text-muted-foreground transition-transform",
														collapsedFiles[entry.filename] === true &&
															"-rotate-90",
													)}
												/>
											</button>
											<span className="font-mono font-medium truncate min-w-0">
												{entry.filename}
											</span>
											{entry.reviewComments.length > 0 && (
												<Badge
													variant="outline"
													className="text-[9px] h-4 px-1"
												>
													{entry.reviewComments.length} comment
													{entry.reviewComments.length === 1 ? "" : "s"}
												</Badge>
											)}
											<span className="ml-auto flex gap-1.5 shrink-0">
												<span className="text-green-600">
													+{entry.additions}
												</span>
												<span className="text-red-600">-{entry.deletions}</span>
											</span>
										</div>
										{collapsedFiles[entry.filename] !== true && (
											<>
												{entry.patch !== null ? (
													<div className="overflow-x-auto border rounded-b-md">
														<PatchDiff
															patch={entry.patch}
															options={{
																diffStyle: viewMode,
																disableFileHeader: true,
															}}
														/>
													</div>
												) : (
													<div className="rounded-b-md border border-t-0 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
														No inline patch available for this file (binary file
														or GitHub truncation).
													</div>
												)}

												{entry.reviewComments.length > 0 && (
													<div className="rounded-b-md border border-t-0 bg-muted/10 p-2 space-y-2">
														<p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/80">
															Review comments
														</p>
														{reviewThreads.map((thread) => (
															<ReviewThreadConversation
																key={thread.root.githubReviewCommentId}
																thread={thread}
																ownerLogin={owner}
																name={name}
																repositoryId={pr.repositoryId}
																prNumber={pr.number}
																onAddDraftReply={onAddDraftReply}
															/>
														))}
													</div>
												)}
											</>
										)}
									</div>
								);
							})}
						</div>
					)}
					{filteredEntries.length === 0 && (
						<div className="rounded-md border bg-muted/10 px-3 py-4 text-xs text-muted-foreground">
							No files match your filter.
						</div>
					)}
				</div>
			)}

			{files.length === 0 && isSyncingFiles && (
				<div className="space-y-3">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<div className="size-3.5 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" />
						<span>Loading file changes...</span>
					</div>
					{[1, 2, 3].map((i) => (
						<div key={i}>
							<Skeleton className="h-8 w-full rounded-t-md rounded-b-none" />
							<Skeleton className="h-24 w-full rounded-t-none rounded-b-md" />
						</div>
					))}
				</div>
			)}

			{files.length === 0 && !isSyncingFiles && (
				<p className="py-8 text-center text-xs text-muted-foreground">
					No file changes synced yet.
				</p>
			)}
		</div>
	);
}

function quoteMarkdown(text: string): string {
	return text
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

function formatDraftReplyLocation(reply: DraftReviewReply): string {
	const path = reply.path ?? "file";
	if (reply.line === null) return path;
	const side = reply.side === "LEFT" ? " old" : "";
	return `${path}:${String(reply.line)}${side}`;
}

function renderDraftRepliesMarkdown(
	draftReplies: ReadonlyArray<DraftReviewReply>,
): string {
	if (draftReplies.length === 0) return "";

	const blocks = draftReplies.map((reply, index) => {
		const author = reply.rootAuthorLogin ?? "reviewer";
		const location = formatDraftReplyLocation(reply);
		return [
			`### Draft thread reply ${String(index + 1)}`,
			`- Location: \`${location}\``,
			`- In reply to: @${author}`,
			"",
			reply.replyBody,
			"",
			"Reference:",
			quoteMarkdown(reply.rootBody),
		].join("\n");
	});

	return blocks.join("\n\n");
}

function ReviewThreadConversation({
	thread,
	ownerLogin,
	name,
	repositoryId,
	prNumber,
	onAddDraftReply,
}: {
	thread: ReviewThread;
	ownerLogin: string;
	name: string;
	repositoryId: number;
	prNumber: number;
	onAddDraftReply: (reply: Omit<DraftReviewReply, "id" | "createdAt">) => void;
}) {
	const writeClient = useGithubWrite();
	const [replyResult, createReply] = useAtom(writeClient.createComment.mutate);
	const [replyBody, setReplyBody] = useState("");
	const [isComposerOpen, setIsComposerOpen] = useState(false);
	const correlationPrefix = useId();
	const isSubmitting = Result.isWaiting(replyResult);
	const isSuccess = Result.isSuccess(replyResult);

	useEffect(() => {
		if (!isSuccess) return;
		setReplyBody("");
		setIsComposerOpen(false);
	}, [isSuccess]);

	const lineLabel =
		thread.root.line === null
			? ""
			: `:${String(thread.root.line)}${thread.root.side === "LEFT" ? " (old)" : ""}`;
	const pathLabel = thread.root.path === null ? "this file" : thread.root.path;
	const rootAuthor = thread.root.authorLogin ?? "reviewer";

	const submitReply = () => {
		const trimmedReply = replyBody.trim();
		if (trimmedReply.length === 0) return;

		const body = [
			`Replying to @${rootAuthor} on \`${pathLabel}${lineLabel}\`:`,
			"",
			trimmedReply,
			"",
			"---",
			quoteMarkdown(thread.root.body),
		].join("\n");

		createReply({
			correlationId: `${correlationPrefix}-thread-reply-${Date.now()}`,
			ownerLogin,
			name,
			repositoryId,
			number: prNumber,
			body,
		});
	};

	const addReplyToDraft = () => {
		const trimmedReply = replyBody.trim();
		if (trimmedReply.length === 0) return;

		onAddDraftReply({
			path: thread.root.path,
			line: thread.root.line,
			side: thread.root.side,
			rootAuthorLogin: thread.root.authorLogin,
			rootBody: thread.root.body,
			replyBody: trimmedReply,
		});

		setReplyBody("");
		setIsComposerOpen(false);
	};

	return (
		<div className="space-y-1.5">
			<div className="rounded-md border bg-background px-2.5 py-2">
				<div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
					{thread.root.authorLogin !== null && (
						<span className="font-medium text-foreground">
							{thread.root.authorLogin}
						</span>
					)}
					{thread.root.line !== null && (
						<span>
							{thread.root.side === "LEFT" ? "old" : "new"}: {thread.root.line}
						</span>
					)}
					<span>{formatRelative(thread.root.updatedAt)}</span>
					{thread.root.htmlUrl !== null && (
						<Link
							href={thread.root.htmlUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 hover:text-foreground"
						>
							<ExternalLink className="size-3" />
							Open
						</Link>
					)}
				</div>
				<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-xs leading-relaxed">
					<MarkdownBody>{thread.root.body}</MarkdownBody>
				</div>

				<div className="mt-2 flex items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						className="h-6 px-1.5 text-[10px]"
						onClick={() => setIsComposerOpen((current) => !current)}
					>
						{isComposerOpen ? "Cancel reply" : "Reply in conversation"}
					</Button>
					{Result.isFailure(replyResult) && (
						<span className="text-[10px] text-destructive">
							{extractInteractionError(replyResult, "Reply failed")}
						</span>
					)}
					{isSuccess && (
						<span className="text-[10px] text-green-600">Reply queued</span>
					)}
				</div>

				{isComposerOpen && (
					<div className="mt-2 space-y-1.5 rounded border bg-muted/20 p-2">
						<Textarea
							value={replyBody}
							onChange={(event) => setReplyBody(event.target.value)}
							placeholder="Write a reply. This posts to the PR conversation with quoted thread context."
							rows={3}
							className="text-xs"
							disabled={isSubmitting}
						/>
						<div className="flex justify-end gap-1.5">
							<Button
								variant="outline"
								size="sm"
								className="h-6 px-2 text-[10px]"
								disabled={replyBody.trim().length === 0 || isSubmitting}
								onClick={addReplyToDraft}
							>
								Add to review draft
							</Button>
							<Button
								size="sm"
								className="h-6 px-2 text-[10px]"
								disabled={replyBody.trim().length === 0 || isSubmitting}
								onClick={submitReply}
							>
								{isSubmitting ? "Posting..." : "Post reply"}
							</Button>
						</div>
					</div>
				)}
			</div>

			{thread.replies.map((reply) => (
				<div
					key={reply.githubReviewCommentId}
					className="ml-4 rounded-md border border-l-2 border-l-muted-foreground/50 bg-background px-2.5 py-2"
				>
					<div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
						{reply.authorLogin !== null && (
							<span className="font-medium text-foreground">
								{reply.authorLogin}
							</span>
						)}
						<span>Reply</span>
						<span>{formatRelative(reply.updatedAt)}</span>
					</div>
					<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-xs leading-relaxed">
						<MarkdownBody>{reply.body}</MarkdownBody>
					</div>
				</div>
			))}
		</div>
	);
}

function ReviewDraftReplyCard({
	draftReply,
	onRemove,
	onSave,
}: {
	draftReply: DraftReviewReply;
	onRemove: () => void;
	onSave: (nextBody: string) => void;
}) {
	const [isEditing, setIsEditing] = useState(false);
	const [draftBody, setDraftBody] = useState(draftReply.replyBody);

	useEffect(() => {
		setDraftBody(draftReply.replyBody);
	}, [draftReply.replyBody]);

	const trimmedBody = draftBody.trim();

	return (
		<div className="rounded border bg-background px-2 py-1.5">
			<div className="mb-1 flex items-center justify-between gap-1.5 text-[10px] text-muted-foreground">
				<span className="truncate">{formatDraftReplyLocation(draftReply)}</span>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						className="h-5 px-1 text-[10px]"
						onClick={() => setIsEditing((current) => !current)}
					>
						{isEditing ? "Cancel" : "Edit"}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-5 px-1 text-[10px]"
						onClick={onRemove}
					>
						Remove
					</Button>
				</div>
			</div>

			{isEditing ? (
				<div className="space-y-1.5">
					<Textarea
						value={draftBody}
						onChange={(event) => setDraftBody(event.target.value)}
						rows={3}
						className="text-[11px]"
					/>
					<div className="flex justify-end gap-1">
						<Button
							variant="outline"
							size="sm"
							className="h-6 px-1.5 text-[10px]"
							onClick={() => {
								setDraftBody(draftReply.replyBody);
								setIsEditing(false);
							}}
						>
							Reset
						</Button>
						<Button
							size="sm"
							className="h-6 px-1.5 text-[10px]"
							disabled={trimmedBody.length === 0}
							onClick={() => {
								onSave(trimmedBody);
								setIsEditing(false);
							}}
						>
							Save
						</Button>
					</div>
				</div>
			) : (
				<p className="line-clamp-3 text-[11px] leading-relaxed text-foreground">
					{draftReply.replyBody}
				</p>
			)}

			<p className="mt-1 text-[10px] text-muted-foreground">
				Queued {formatRelative(draftReply.createdAt)}
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Right sidebar: description, actions, checks, reviews, comments
// ---------------------------------------------------------------------------

function InfoSidebar({
	pr,
	owner,
	name,
	prNumber,
	reviewDraftReplies,
	onRemoveDraftReply,
	onUpdateDraftReplyBody,
	onClearDraftReplies,
}: {
	pr: PrDetail;
	owner: string;
	name: string;
	prNumber: number;
	reviewDraftReplies: ReadonlyArray<DraftReviewReply>;
	onRemoveDraftReply: (draftReplyId: string) => void;
	onUpdateDraftReplyBody: (draftReplyId: string, nextBody: string) => void;
	onClearDraftReplies: () => void;
}) {
	const approvedCount = pr.reviews.filter(
		(review) => review.state === "APPROVED",
	).length;
	const changesRequestedCount = pr.reviews.filter(
		(review) => review.state === "CHANGES_REQUESTED",
	).length;
	const commentReviewCount = pr.reviews.filter(
		(review) => review.state === "COMMENTED",
	).length;

	const failingChecksCount = pr.checkRuns.filter(
		(check) => check.conclusion === "failure",
	).length;
	const pendingChecksCount = pr.checkRuns.filter(
		(check) => check.status === "queued" || check.status === "in_progress",
	).length;
	const [activityQuery, setActivityQuery] = useState("");
	const [checkFilter, setCheckFilter] = useState<
		"all" | "failing" | "pending" | "passing"
	>("all");
	const [reviewFilter, setReviewFilter] = useState<
		"all" | "approved" | "changes" | "commented"
	>("all");

	const normalizedActivityQuery = activityQuery.trim().toLowerCase();

	const visibleChecks = pr.checkRuns.filter((check) => {
		const matchesStatus =
			checkFilter === "all"
				? true
				: checkFilter === "failing"
					? check.conclusion === "failure"
					: checkFilter === "pending"
						? check.status === "queued" || check.status === "in_progress"
						: check.conclusion === "success";

		if (!matchesStatus) return false;
		if (normalizedActivityQuery.length === 0) return true;

		const conclusion = check.conclusion ?? "";
		return (
			check.name.toLowerCase().includes(normalizedActivityQuery) ||
			conclusion.toLowerCase().includes(normalizedActivityQuery)
		);
	});

	const visibleReviews = pr.reviews.filter((review) => {
		const matchesState =
			reviewFilter === "all"
				? true
				: reviewFilter === "approved"
					? review.state === "APPROVED"
					: reviewFilter === "changes"
						? review.state === "CHANGES_REQUESTED"
						: review.state === "COMMENTED";

		if (!matchesState) return false;
		if (normalizedActivityQuery.length === 0) return true;

		return (
			(review.authorLogin?.toLowerCase().includes(normalizedActivityQuery) ??
				false) ||
			review.state.toLowerCase().includes(normalizedActivityQuery)
		);
	});

	const visibleComments = pr.comments.filter((comment) => {
		if (normalizedActivityQuery.length === 0) return true;
		return (
			comment.body.toLowerCase().includes(normalizedActivityQuery) ||
			(comment.authorLogin?.toLowerCase().includes(normalizedActivityQuery) ??
				false)
		);
	});

	const orderedDraftReplies = [...reviewDraftReplies].sort(
		(a, b) => a.createdAt - b.createdAt,
	);

	return (
		<div className="p-3 space-y-4">
			{/* Branch info */}
			<div>
				<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1">
					Branches
				</h3>
				<div className="text-xs text-muted-foreground">
					<code className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-mono">
						{pr.headRefName}
					</code>
					<span className="mx-1 text-muted-foreground/40">&rarr;</span>
					<code className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-mono">
						{pr.baseRefName}
					</code>
				</div>
			</div>

			{/* Metadata */}
			<div className="flex flex-wrap items-center gap-1.5">
				{pr.mergeableState && <MergeableStateBadge state={pr.mergeableState} />}
				<Badge variant="outline" className="text-[10px] font-mono">
					{pr.headSha.slice(0, 7)}
				</Badge>
			</div>

			{/* Review/check summary */}
			<div>
				<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
					Summary
				</h3>
				<div className="grid grid-cols-2 gap-1.5 text-xs">
					<div className="rounded border bg-background px-2 py-1.5">
						<p className="text-[10px] text-muted-foreground">Approvals</p>
						<p className="font-semibold tabular-nums">{approvedCount}</p>
					</div>
					<div className="rounded border bg-background px-2 py-1.5">
						<p className="text-[10px] text-muted-foreground">
							Changes requested
						</p>
						<p className="font-semibold tabular-nums">
							{changesRequestedCount}
						</p>
					</div>
					<div className="rounded border bg-background px-2 py-1.5">
						<p className="text-[10px] text-muted-foreground">Review comments</p>
						<p className="font-semibold tabular-nums">
							{pr.reviewComments.length}
						</p>
					</div>
					<div className="rounded border bg-background px-2 py-1.5">
						<p className="text-[10px] text-muted-foreground">
							General comments
						</p>
						<p className="font-semibold tabular-nums">{pr.comments.length}</p>
					</div>
				</div>
				<div className="mt-1.5 flex flex-wrap gap-1">
					{failingChecksCount > 0 && (
						<Badge variant="destructive" className="text-[10px]">
							{failingChecksCount} failing check
							{failingChecksCount === 1 ? "" : "s"}
						</Badge>
					)}
					{pendingChecksCount > 0 && (
						<Badge variant="outline" className="text-[10px]">
							{pendingChecksCount} pending check
							{pendingChecksCount === 1 ? "" : "s"}
						</Badge>
					)}
					{commentReviewCount > 0 && (
						<Badge variant="outline" className="text-[10px]">
							{commentReviewCount} comment review
							{commentReviewCount === 1 ? "" : "s"}
						</Badge>
					)}
				</div>
			</div>

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
				headSha={pr.headSha}
			/>

			{/* Pending review draft replies */}
			{orderedDraftReplies.length > 0 && (
				<div className="rounded-md border bg-muted/10 p-2">
					<div className="mb-1.5 flex items-center justify-between gap-2">
						<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
							Review Draft ({orderedDraftReplies.length})
						</h3>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-1.5 text-[10px]"
							onClick={onClearDraftReplies}
						>
							Clear
						</Button>
					</div>
					<div className="space-y-1.5">
						{orderedDraftReplies.map((draftReply) => (
							<ReviewDraftReplyCard
								key={draftReply.id}
								draftReply={draftReply}
								onRemove={() => onRemoveDraftReply(draftReply.id)}
								onSave={(nextBody) =>
									onUpdateDraftReplyBody(draftReply.id, nextBody)
								}
							/>
						))}
					</div>
				</div>
			)}

			{/* Submit Review */}
			{pr.state === "open" && pr.mergedAt === null && (
				<ReviewSubmitSection
					ownerLogin={owner}
					name={name}
					repositoryId={pr.repositoryId}
					number={prNumber}
					draftReplies={reviewDraftReplies}
					onClearDraftReplies={onClearDraftReplies}
				/>
			)}

			{/* Body / Description */}
			{pr.body && <CollapsibleDescription body={pr.body} />}

			{/* Assignees */}
			<AssigneesCombobox
				ownerLogin={owner}
				name={name}
				repositoryId={pr.repositoryId}
				number={prNumber}
				currentAssignees={pr.assignees}
				optimisticOperationType={pr.optimisticOperationType}
				optimisticState={pr.optimisticState}
				optimisticErrorMessage={pr.optimisticErrorMessage}
			/>

			{/* Labels */}
			<LabelsCombobox
				ownerLogin={owner}
				name={name}
				repositoryId={pr.repositoryId}
				number={prNumber}
				currentLabels={pr.labelNames}
				optimisticOperationType={pr.optimisticOperationType}
				optimisticState={pr.optimisticState}
				optimisticErrorMessage={pr.optimisticErrorMessage}
			/>

			{/* Activity filters */}
			<div className="space-y-1.5 rounded-md border bg-muted/10 p-2">
				<p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
					Activity filters
				</p>
				<div className="relative">
					<Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={activityQuery}
						onChange={(event) => setActivityQuery(event.target.value)}
						placeholder="Filter checks/reviews/comments"
						className="h-7 pl-7 text-[11px]"
					/>
				</div>
				<div className="flex flex-wrap gap-1">
					<Button
						variant={checkFilter === "all" ? "default" : "outline"}
						size="sm"
						className="h-6 px-1.5 text-[10px]"
						onClick={() => setCheckFilter("all")}
					>
						All checks
					</Button>
					<Button
						variant={checkFilter === "failing" ? "default" : "outline"}
						size="sm"
						className="h-6 px-1.5 text-[10px]"
						onClick={() => setCheckFilter("failing")}
					>
						Failing
					</Button>
					<Button
						variant={checkFilter === "pending" ? "default" : "outline"}
						size="sm"
						className="h-6 px-1.5 text-[10px]"
						onClick={() => setCheckFilter("pending")}
					>
						Pending
					</Button>
					<Button
						variant={checkFilter === "passing" ? "default" : "outline"}
						size="sm"
						className="h-6 px-1.5 text-[10px]"
						onClick={() => setCheckFilter("passing")}
					>
						Passing
					</Button>
				</div>
				<div className="flex flex-wrap gap-1">
					<Button
						variant={reviewFilter === "all" ? "default" : "outline"}
						size="sm"
						className="h-6 px-1.5 text-[10px]"
						onClick={() => setReviewFilter("all")}
					>
						All reviews
					</Button>
					<Button
						variant={reviewFilter === "approved" ? "default" : "outline"}
						size="sm"
						className="h-6 px-1.5 text-[10px]"
						onClick={() => setReviewFilter("approved")}
					>
						Approved
					</Button>
					<Button
						variant={reviewFilter === "changes" ? "default" : "outline"}
						size="sm"
						className="h-6 px-1.5 text-[10px]"
						onClick={() => setReviewFilter("changes")}
					>
						Changes
					</Button>
					<Button
						variant={reviewFilter === "commented" ? "default" : "outline"}
						size="sm"
						className="h-6 px-1.5 text-[10px]"
						onClick={() => setReviewFilter("commented")}
					>
						Commented
					</Button>
				</div>
			</div>

			{/* Check runs */}
			{pr.checkRuns.length > 0 && (
				<div>
					<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
						Checks <span className="font-normal">({visibleChecks.length})</span>
					</h3>
					{visibleChecks.length > 0 ? (
						<div className="divide-y rounded-md border">
							{visibleChecks.map((check) => (
								<Link
									key={check.githubCheckRunId}
									href={`https://github.com/${owner}/${name}/runs/${String(check.githubCheckRunId)}`}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-muted/50 transition-colors group"
								>
									<div className="flex items-center gap-2 min-w-0">
										<CheckIcon
											status={check.status}
											conclusion={check.conclusion}
										/>
										<span className="text-xs truncate group-hover:underline">
											{check.name}
										</span>
									</div>
									<div className="flex items-center gap-1.5 shrink-0">
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
													"text-[10px]",
													check.conclusion === "success" && "text-green-600",
												)}
											>
												{check.conclusion}
											</Badge>
										)}
										<ExternalLink className="size-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
									</div>
								</Link>
							))}
						</div>
					) : (
						<p className="rounded-md border bg-muted/10 px-2.5 py-2 text-xs text-muted-foreground">
							No checks match the active filters.
						</p>
					)}
				</div>
			)}

			{/* Reviews */}
			{pr.reviews.length > 0 && (
				<div>
					<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
						Reviews{" "}
						<span className="font-normal">({visibleReviews.length})</span>
					</h3>
					{visibleReviews.length > 0 ? (
						<div className="space-y-1">
							{visibleReviews.map((review) => (
								<div
									key={review.githubReviewId}
									className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
								>
									{review.authorLogin && (
										<Avatar className="size-4">
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
									<ReviewOptimisticBadge
										optimisticState={review.optimisticState}
										optimisticErrorMessage={review.optimisticErrorMessage}
									/>
									{review.submittedAt && (
										<span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
											{formatRelative(review.submittedAt)}
										</span>
									)}
								</div>
							))}
						</div>
					) : (
						<p className="rounded-md border bg-muted/10 px-2.5 py-2 text-xs text-muted-foreground">
							No reviews match the active filters.
						</p>
					)}
				</div>
			)}

			{/* Comments */}
			{pr.comments.length > 0 && (
				<div>
					<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
						Comments{" "}
						<span className="font-normal">({visibleComments.length})</span>
					</h3>
					{visibleComments.length > 0 ? (
						<div className="space-y-2">
							{visibleComments.map((comment) => (
								<Card key={comment.githubCommentId}>
									<CardHeader className="pb-0">
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
													<span className="font-semibold">
														{comment.authorLogin}
													</span>
												</span>
											)}
											<span className="text-muted-foreground/60 tabular-nums">
												{formatRelative(comment.createdAt)}
											</span>
										</div>
									</CardHeader>
									<CardContent>
										<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-xs leading-relaxed">
											<MarkdownBody>{comment.body}</MarkdownBody>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					) : (
						<p className="rounded-md border bg-muted/10 px-2.5 py-2 text-xs text-muted-foreground">
							No comments match the active filters.
						</p>
					)}
				</div>
			)}

			{/* Comment form */}
			<Separator />
			<CommentForm
				ownerLogin={owner}
				name={name}
				number={prNumber}
				repositoryId={pr.repositoryId}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Collapsible description — shows a preview with expand toggle
// ---------------------------------------------------------------------------

function CollapsibleDescription({ body }: { body: string }) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div>
			<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
				Description
			</h3>
			<Card className="relative overflow-hidden">
				<CardContent>
					<div
						className={cn(
							"prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-xs leading-relaxed",
							!expanded && "max-h-24 overflow-hidden",
						)}
					>
						<MarkdownBody>{body}</MarkdownBody>
					</div>
				</CardContent>
				{/* ───▼─── border toggle */}
				<button
					type="button"
					onClick={() => setExpanded((prev) => !prev)}
					className="relative flex w-full items-center justify-center border-t border-border/60 py-1 hover:bg-muted/50 transition-colors cursor-pointer"
				>
					<ChevronDown
						className={cn(
							"size-3.5 text-muted-foreground transition-transform duration-200",
							expanded && "rotate-180",
						)}
					/>
				</button>
			</Card>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Action bar
// ---------------------------------------------------------------------------

function PrActionBar({
	ownerLogin,
	name,
	number,
	repositoryId,
	state,
	draft,
	mergedAt,
	mergeableState,
	headSha,
}: {
	ownerLogin: string;
	name: string;
	number: number;
	repositoryId: number;
	state: "open" | "closed";
	draft: boolean;
	mergedAt: number | null;
	mergeableState: string | null;
	headSha: string;
}) {
	const writeClient = useGithubWrite();
	const [mergeResult, doMerge] = useAtom(writeClient.mergePullRequest.mutate);
	const [branchUpdateResult, doUpdateBranch] = useAtom(
		writeClient.updatePullRequestBranch.mutate,
	);
	const [stateResult, doUpdateState] = useAtom(
		writeClient.updateIssueState.mutate,
	);
	const correlationPrefix = useId();
	const isMerging = Result.isWaiting(mergeResult);
	const isUpdatingBranch = Result.isWaiting(branchUpdateResult);
	const isUpdatingState = Result.isWaiting(stateResult);

	if (mergedAt !== null) return null;
	const isMergeable =
		state === "open" &&
		!draft &&
		(mergeableState === "clean" || mergeableState === "unstable");
	const canUpdateBranch = state === "open" && mergeableState === "behind";

	return (
		<div className="flex flex-wrap items-center gap-2">
			{canUpdateBranch && (
				<Button
					variant="outline"
					size="sm"
					disabled={isUpdatingBranch}
					className="h-7 text-xs"
					onClick={() => {
						doUpdateBranch({
							correlationId: `${correlationPrefix}-update-branch-${Date.now()}`,
							ownerLogin,
							name,
							repositoryId,
							number,
							expectedHeadSha: headSha,
						});
					}}
				>
					{isUpdatingBranch ? "Updating..." : "Update branch"}
				</Button>
			)}
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
			{Result.isFailure(branchUpdateResult) && (
				<span className="text-xs text-destructive">Branch update failed.</span>
			)}
			{Result.isFailure(stateResult) && (
				<span className="text-xs text-destructive">Update failed.</span>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Comment form
// ---------------------------------------------------------------------------

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
		<div>
			<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
				Add a comment
			</h3>
			<Textarea
				placeholder="Leave a comment..."
				value={body}
				onChange={(e) => setBody(e.target.value)}
				rows={3}
				disabled={isSubmitting}
				className="mb-2 text-xs"
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
					className="h-7 text-xs"
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

// ---------------------------------------------------------------------------
// Review submit
// ---------------------------------------------------------------------------

function ReviewSubmitSection({
	ownerLogin,
	name,
	repositoryId,
	number,
	draftReplies,
	onClearDraftReplies,
}: {
	ownerLogin: string;
	name: string;
	repositoryId: number;
	number: number;
	draftReplies: ReadonlyArray<DraftReviewReply>;
	onClearDraftReplies: () => void;
}) {
	const writeClient = useGithubWrite();
	const [reviewResult, submitReview] = useAtom(
		writeClient.submitPrReview.mutate,
	);
	const [body, setBody] = useState("");
	const correlationPrefix = useId();
	const [pendingEvent, setPendingEvent] = useState<
		"APPROVE" | "REQUEST_CHANGES" | "COMMENT" | null
	>(null);
	const [includeDraftReplies, setIncludeDraftReplies] = useState(true);
	const [showDraftPreview, setShowDraftPreview] = useState(false);
	const isSubmitting = Result.isWaiting(reviewResult);

	useEffect(() => {
		if (draftReplies.length > 0) {
			setIncludeDraftReplies(true);
		}
	}, [draftReplies.length]);

	const handleSubmit = (event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") => {
		const trimmedBody = body.trim();
		const draftMarkdown = renderDraftRepliesMarkdown(
			includeDraftReplies ? draftReplies : [],
		);
		const finalBody = [trimmedBody, draftMarkdown]
			.filter((section) => section.length > 0)
			.join("\n\n");

		setPendingEvent(event);
		submitReview({
			correlationId: `${correlationPrefix}-review-${Date.now()}`,
			ownerLogin,
			name,
			repositoryId,
			number,
			event,
			body: finalBody.length > 0 ? finalBody : undefined,
		});
	};

	// Clear body on success
	const isSuccess = Result.isSuccess(reviewResult);
	useEffect(() => {
		if (isSuccess) {
			setBody("");
			setPendingEvent(null);
			setShowDraftPreview(false);
			onClearDraftReplies();
		}
	}, [isSuccess, onClearDraftReplies]);

	return (
		<div>
			<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
				Submit Review
			</h3>
			{draftReplies.length > 0 && (
				<div className="mb-2 rounded border bg-muted/10 px-2 py-1.5">
					<div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
						<span>
							{draftReplies.length} draft repl
							{draftReplies.length === 1 ? "y" : "ies"}{" "}
							{includeDraftReplies ? "will be included" : "currently excluded"}
						</span>
						<div className="flex items-center gap-1">
							<Button
								variant={includeDraftReplies ? "default" : "outline"}
								size="sm"
								className="h-5 px-1 text-[10px]"
								onClick={() => setIncludeDraftReplies((current) => !current)}
							>
								{includeDraftReplies ? "Included" : "Excluded"}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-5 px-1 text-[10px]"
								onClick={() => setShowDraftPreview((current) => !current)}
							>
								{showDraftPreview ? "Hide" : "Preview"}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-5 px-1 text-[10px]"
								onClick={onClearDraftReplies}
							>
								Clear
							</Button>
						</div>
					</div>
					{showDraftPreview && (
						<div className="mt-1 rounded border bg-background p-2">
							<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-[11px] leading-relaxed">
								<MarkdownBody>
									{renderDraftRepliesMarkdown(
										includeDraftReplies ? draftReplies : [],
									)}
								</MarkdownBody>
							</div>
						</div>
					)}
				</div>
			)}
			<Textarea
				placeholder="Leave a review comment..."
				value={body}
				onChange={(e) => setBody(e.target.value)}
				rows={2}
				disabled={isSubmitting}
				className="text-xs"
			/>
			<div className="flex gap-1.5 mt-2">
				<Button
					size="sm"
					className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white flex-1"
					disabled={isSubmitting}
					onClick={() => handleSubmit("APPROVE")}
				>
					{isSubmitting && pendingEvent === "APPROVE"
						? "Submitting..."
						: "Approve"}
				</Button>
				<Button
					size="sm"
					variant="destructive"
					className="h-7 text-xs flex-1"
					disabled={isSubmitting}
					onClick={() => handleSubmit("REQUEST_CHANGES")}
				>
					{isSubmitting && pendingEvent === "REQUEST_CHANGES"
						? "Submitting..."
						: "Changes"}
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="h-7 text-xs flex-1"
					disabled={isSubmitting}
					onClick={() => handleSubmit("COMMENT")}
				>
					{isSubmitting && pendingEvent === "COMMENT"
						? "Submitting..."
						: "Comment"}
				</Button>
			</div>
			{Result.isFailure(reviewResult) && (
				<p className="mt-1 text-xs text-destructive">
					{extractInteractionError(reviewResult, "Could not queue review")}
				</p>
			)}
			{isSuccess && (
				<p className="mt-1 text-xs text-green-600">
					Review queued. Syncing with GitHub...
				</p>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Icons & badges
// ---------------------------------------------------------------------------

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

function ReviewOptimisticBadge({
	optimisticState,
	optimisticErrorMessage,
}: {
	optimisticState: "pending" | "failed" | "confirmed" | null;
	optimisticErrorMessage: string | null;
}) {
	if (optimisticState === "failed") {
		return (
			<Badge variant="destructive" className="text-[10px]">
				{optimisticErrorMessage ?? "GitHub rejected this review."}
			</Badge>
		);
	}
	if (optimisticState === "pending") {
		return (
			<Badge variant="outline" className="text-[10px]">
				Syncing with GitHub
			</Badge>
		);
	}
	if (optimisticState === "confirmed") {
		return (
			<Badge variant="secondary" className="text-[10px] text-green-600">
				Confirmed by GitHub
			</Badge>
		);
	}
	return null;
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

function FileStatusBadge({ status }: { status: string }) {
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

type ReviewCommentItem = PrDetail["reviewComments"][number];

type ReviewThread = {
	readonly root: ReviewCommentItem;
	readonly replies: ReadonlyArray<ReviewCommentItem>;
};

function buildReviewThreads(
	comments: ReadonlyArray<ReviewCommentItem>,
): ReadonlyArray<ReviewThread> {
	const repliesByParentId: Record<number, Array<ReviewCommentItem>> = {};
	const roots: Array<ReviewCommentItem> = [];

	for (const comment of comments) {
		if (comment.inReplyToGithubReviewCommentId === null) {
			roots.push(comment);
			continue;
		}

		const parentId = comment.inReplyToGithubReviewCommentId;
		const existingReplies = repliesByParentId[parentId] ?? [];
		existingReplies.push(comment);
		repliesByParentId[parentId] = existingReplies;
	}

	const sortedRoots = [...roots].sort((a, b) => a.createdAt - b.createdAt);

	return sortedRoots.map((root) => {
		const replies = repliesByParentId[root.githubReviewCommentId] ?? [];
		const sortedReplies = [...replies].sort(
			(a, b) => a.createdAt - b.createdAt,
		);
		return {
			root,
			replies: sortedReplies,
		};
	});
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
