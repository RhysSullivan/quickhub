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
import {
	ArrowDown,
	ArrowUp,
	CheckCircle2,
	ChevronDown,
	ChevronsDown,
	ChevronsUp,
	Clock,
	Columns2,
	ExternalLink,
	FolderOpen,
	ListChecks,
	Loader2,
	MessageSquare,
	Rows3,
	Search,
	TriangleAlert,
} from "@packages/ui/components/icons";
import { Input } from "@packages/ui/components/input";
import { Kbd } from "@packages/ui/components/kbd";
import { Link } from "@packages/ui/components/link";
import { Separator } from "@packages/ui/components/separator";
import { Skeleton } from "@packages/ui/components/skeleton";
import { Textarea } from "@packages/ui/components/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@packages/ui/components/tooltip";
import { cn } from "@packages/ui/lib/utils";
import { useCodeBrowse } from "@packages/ui/rpc/code-browse";
import { useGithubActions } from "@packages/ui/rpc/github-actions";
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useOnDemandSync } from "@packages/ui/rpc/on-demand-sync";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import type { FileDiffOptions } from "@pierre/diffs";
import {
	type DiffLineAnnotation,
	MultiFileDiff,
	PatchDiff,
} from "@pierre/diffs/react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Option } from "effect";
import {
	forwardRef,
	memo,
	type ReactElement,
	useCallback,
	useEffect,
	useId,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { AssigneesCombobox } from "@/app/(main-site)/_components/assignees-combobox";
import { LabelsCombobox } from "@/app/(main-site)/_components/labels-combobox";
import { PrDetailSkeleton } from "@/app/(main-site)/_components/skeletons";
import { MarkdownBody } from "@/components/markdown-body";
import {
	extractErrorMessage,
	extractErrorReason,
	extractErrorTag,
	extractRpcDefectMessage,
} from "@/lib/rpc-error";

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

	const message = extractErrorMessage(err);
	if (message !== null) return message;

	const reason = extractErrorReason(err);
	if (reason !== null) return reason;

	if (extractErrorTag(err) === "RpcDefectError") {
		const defectMessage = extractRpcDefectMessage(err);
		if (defectMessage !== null) return defectMessage;
	}

	return fallback;
}

function normalizeReviewState(state: string): string {
	return state.trim().replaceAll(" ", "_").toUpperCase();
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
		readonly runNumber: number | null;
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

type InlineReviewCommentTarget = {
	readonly filename: string;
	readonly startLine: number | null;
	readonly startSide: "LEFT" | "RIGHT" | null;
	readonly line: number;
	readonly side: "LEFT" | "RIGHT";
};

type InlineDiffAnnotation = {
	readonly kind: "composer";
	readonly target: InlineReviewCommentTarget;
};

type DiffSelectedLineRange = {
	readonly start: number;
	readonly side?: "deletions" | "additions";
	readonly end: number;
	readonly endSide?: "deletions" | "additions";
};

type ActiveLineSelection = {
	readonly filename: string;
	readonly range: DiffSelectedLineRange;
};

function mapDiffAnnotationSideToGithub(
	side: "deletions" | "additions" | undefined,
): "LEFT" | "RIGHT" | null {
	if (side === "deletions") return "LEFT";
	if (side === "additions") return "RIGHT";
	return null;
}

function buildInlineTargetFromSelection(
	filename: string,
	range: DiffSelectedLineRange,
): InlineReviewCommentTarget | null {
	const startSide = mapDiffAnnotationSideToGithub(range.side);
	const endSide = mapDiffAnnotationSideToGithub(range.endSide ?? range.side);
	if (endSide === null) return null;

	const minLine = Math.min(range.start, range.end);
	const maxLine = Math.max(range.start, range.end);

	if (minLine === maxLine || startSide === null || startSide !== endSide) {
		return {
			filename,
			startLine: null,
			startSide: null,
			line: range.end,
			side: endSide,
		};
	}

	return {
		filename,
		startLine: minLine,
		startSide,
		line: maxLine,
		side: endSide,
	};
}

function inlineTargetsEqual(
	left: InlineReviewCommentTarget | null,
	right: InlineReviewCommentTarget,
): boolean {
	if (left === null) return false;
	return (
		left.filename === right.filename &&
		left.startLine === right.startLine &&
		left.startSide === right.startSide &&
		left.line === right.line &&
		left.side === right.side
	);
}

type FullContextDiffState = {
	readonly status: "loading" | "ready" | "error";
	readonly files: {
		readonly oldFile: {
			readonly name: string;
			readonly contents: string;
		};
		readonly newFile: {
			readonly name: string;
			readonly contents: string;
		};
	} | null;
	readonly errorMessage: string | null;
};

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

function patchHasCollapsedContext(patch: string): boolean {
	return Array.from(patch.matchAll(HUNK_HEADER_PATTERN)).length > 0;
}

function MouseDownExpandContainer({
	children,
	disabledExpandTooltip,
}: {
	children: ReactElement;
	disabledExpandTooltip?: string;
}) {
	const wrapperRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const host = wrapperRef.current?.querySelector("diffs-container");
		if (!(host instanceof HTMLElement)) return;

		const shadow = host.shadowRoot;
		if (shadow === null) return;

		const isExpandedDisabled = disabledExpandTooltip !== undefined;
		const setExpandButtonState = () => {
			const buttons = shadow.querySelectorAll<HTMLElement>(
				"[data-expand-button]",
			);
			for (const button of buttons) {
				if (!isExpandedDisabled) {
					delete button.dataset.fasterghExpandDisabled;
					button.removeAttribute("disabled");
					button.removeAttribute("aria-disabled");
					button.style.opacity = "";
					button.style.cursor = "";
					button.style.filter = "";
					button.title = "";
					if (button.dataset.fasterghOriginalTitle !== undefined) {
						button.title = button.dataset.fasterghOriginalTitle;
						delete button.dataset.fasterghOriginalTitle;
					}
					continue;
				}

				const tooltip =
					disabledExpandTooltip ?? "Could not load full context for this file";
				button.dataset.fasterghExpandDisabled = "true";
				button.dataset.fasterghOriginalTitle = button.title;
				button.setAttribute("disabled", "");
				button.setAttribute("aria-disabled", "true");
				button.style.opacity = "0.45";
				button.style.cursor = "not-allowed";
				button.style.filter = "grayscale(1)";
				button.title = tooltip;
			}
		};

		setExpandButtonState();

		let suppressNextClick = false;

		const getExpandButton = (event: Event): HTMLElement | null => {
			for (const node of event.composedPath()) {
				if (
					node instanceof HTMLElement &&
					node.dataset.expandButton !== undefined
				) {
					return node;
				}
			}
			return null;
		};

		const handleMouseDown = (event: Event) => {
			if (!(event instanceof MouseEvent)) return;
			if (event.button !== 0) return;
			const expandButton = getExpandButton(event);
			if (expandButton === null) return;
			if (expandButton.dataset.fasterghExpandDisabled === "true") {
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			suppressNextClick = true;
			expandButton.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					cancelable: true,
					composed: true,
				}),
			);
		};

		const handleClickCapture = (event: Event) => {
			if (!suppressNextClick) return;
			const expandButton = getExpandButton(event);
			if (expandButton === null) return;

			suppressNextClick = false;
			event.preventDefault();
			event.stopPropagation();
		};

		shadow.addEventListener("mousedown", handleMouseDown, true);
		shadow.addEventListener("click", handleClickCapture, true);

		return () => {
			shadow.removeEventListener("mousedown", handleMouseDown, true);
			shadow.removeEventListener("click", handleClickCapture, true);
		};
	}, [disabledExpandTooltip]);

	return <div ref={wrapperRef}>{children}</div>;
}

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
	const reviewDraftStorageKey = `fastergh.review-draft.${owner}.${name}.${String(prNumber)}`;

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

	const isSyncingFiles = filesData.files.length === 0;

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

	const [focusedFilename, setFocusedFilename] = useState<string | null>(null);
	const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
	const diffPanelRef = useRef<DiffPanelHandle>(null);

	const handleJumpToFile = useCallback((filename: string) => {
		diffPanelRef.current?.jumpToFile(filename);
	}, []);

	const fileTree = useMemo(
		() =>
			buildFileTree(
				filesData.files.map((file) => ({
					filename: file.filename,
					status: file.status,
					additions: file.additions,
					deletions: file.deletions,
					reviewComments:
						pr?.reviewComments.filter(
							(comment) => comment.path === file.filename,
						) ?? [],
				})),
			),
		[filesData.files, pr?.reviewComments],
	);

	useHotkey("]", (event) => {
		event.preventDefault();
		setIsRightSidebarOpen((current) => !current);
	});

	if (pr === null) {
		return <PrDetailSkeleton />;
	}

	return (
		<div className="flex h-full">
			{/* Main area: diff */}
			<div className="flex-1 min-w-0 h-full overflow-y-auto scroll-smooth">
				<DiffPanel
					ref={diffPanelRef}
					pr={pr}
					filesData={filesData}
					isSyncingFiles={isSyncingFiles}
					owner={owner}
					name={name}
					focusedFilename={focusedFilename}
					onFocusFile={setFocusedFilename}
					onAddDraftReply={addDraftReply}
				/>
			</div>

			{/* Right sidebar: file tree, description, metadata, reviews, comments */}
			{isRightSidebarOpen && (
				<div className="hidden lg:flex w-80 xl:w-96 shrink-0 border-l h-full flex-col overflow-y-auto">
					<InfoSidebar
						pr={pr}
						owner={owner}
						name={name}
						prNumber={prNumber}
						fileTree={fileTree}
						fileCount={filesData.files.length}
						focusedFilename={focusedFilename}
						onJumpToFile={handleJumpToFile}
						reviewDraftReplies={reviewDraftReplies}
						onRemoveDraftReply={removeDraftReply}
						onUpdateDraftReplyBody={updateDraftReplyBody}
						onClearDraftReplies={clearDraftReplies}
					/>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Change stats mini-bar — visual representation of additions vs deletions
// ---------------------------------------------------------------------------

function ChangeStatsBar({
	additions,
	deletions,
	className,
}: {
	additions: number;
	deletions: number;
	className?: string;
}) {
	const total = additions + deletions;
	if (total === 0) return null;

	const addPct = Math.round((additions / total) * 100);
	const delPct = 100 - addPct;

	const SQUARES = 5;
	const addSquares = Math.round((additions / total) * SQUARES);
	const delSquares = SQUARES - addSquares;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className={cn("inline-flex items-center gap-0.5", className)}>
					{Array.from({ length: addSquares }, (_, i) => (
						<span
							key={`a-${String(i)}`}
							className="inline-block size-[7px] rounded-[2px] bg-github-open"
						/>
					))}
					{Array.from({ length: delSquares }, (_, i) => (
						<span
							key={`d-${String(i)}`}
							className="inline-block size-[7px] rounded-[2px] bg-github-closed"
						/>
					))}
				</span>
			</TooltipTrigger>
			<TooltipContent>
				+{additions} / -{deletions} ({addPct}% added, {delPct}% removed)
			</TooltipContent>
		</Tooltip>
	);
}

// ---------------------------------------------------------------------------
// Grouped file tree for the "jump to file" panel
// ---------------------------------------------------------------------------

type FileTreeNode = {
	readonly name: string;
	readonly fullPath: string;
	readonly isDir: boolean;
	readonly status?: string;
	readonly additions?: number;
	readonly deletions?: number;
	readonly commentCount?: number;
	readonly children: Array<FileTreeNode>;
};

function buildFileTree(
	entries: ReadonlyArray<{
		filename: string;
		status: string;
		additions: number;
		deletions: number;
		reviewComments: ReadonlyArray<unknown>;
	}>,
): Array<FileTreeNode> {
	const root: Array<FileTreeNode> = [];

	for (const entry of entries) {
		const parts = entry.filename.split("/");
		let currentLevel = root;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (part === undefined) continue;
			const isLast = i === parts.length - 1;
			const fullPath = parts.slice(0, i + 1).join("/");

			const existing = currentLevel.find((node) => node.name === part);

			if (isLast) {
				currentLevel.push({
					name: part,
					fullPath,
					isDir: false,
					status: entry.status,
					additions: entry.additions,
					deletions: entry.deletions,
					commentCount: entry.reviewComments.length,
					children: [],
				});
			} else if (existing !== undefined && existing.isDir) {
				currentLevel = existing.children;
			} else {
				const dirNode: FileTreeNode = {
					name: part,
					fullPath,
					isDir: true,
					children: [],
				};
				currentLevel.push(dirNode);
				currentLevel = dirNode.children;
			}
		}
	}

	// Collapse single-child directories
	function collapse(nodes: Array<FileTreeNode>): Array<FileTreeNode> {
		return nodes.map((node) => {
			if (
				node.isDir &&
				node.children.length === 1 &&
				node.children[0] !== undefined &&
				node.children[0].isDir
			) {
				const child = node.children[0];
				const collapsed: FileTreeNode = {
					...child,
					name: `${node.name}/${child.name}`,
					children: collapse(child.children),
				};
				return collapsed;
			}
			return { ...node, children: node.isDir ? collapse(node.children) : [] };
		});
	}

	return collapse(root);
}

function FileTreeItem({
	node,
	focusedFilename,
	onJumpToFile,
	depth,
}: {
	node: FileTreeNode;
	focusedFilename: string | null;
	onJumpToFile: (filename: string) => void;
	depth: number;
}) {
	const [isOpen, setIsOpen] = useState(true);

	if (node.isDir) {
		return (
			<div>
				<button
					type="button"
					onClick={() => setIsOpen((prev) => !prev)}
					className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/50 transition-colors"
					style={{ paddingLeft: `${depth * 12 + 6}px` }}
				>
					<ChevronDown
						className={cn(
							"size-3 shrink-0 transition-transform duration-150",
							!isOpen && "-rotate-90",
						)}
					/>
					<FolderOpen className="size-3 shrink-0 text-muted-foreground/60" />
					<span className="truncate font-mono">{node.name}</span>
				</button>
				{isOpen && (
					<div>
						{node.children.map((child) => (
							<FileTreeItem
								key={child.fullPath}
								node={child}
								focusedFilename={focusedFilename}
								onJumpToFile={onJumpToFile}
								depth={depth + 1}
							/>
						))}
					</div>
				)}
			</div>
		);
	}

	const isFocused = focusedFilename === node.fullPath;

	return (
		<button
			type="button"
			onClick={() => onJumpToFile(node.fullPath)}
			className={cn(
				"flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[11px] transition-colors",
				isFocused
					? "bg-accent text-accent-foreground"
					: "text-foreground hover:bg-muted/50",
			)}
			style={{ paddingLeft: `${depth * 12 + 6}px` }}
		>
			<FileStatusBadge status={node.status ?? "modified"} />
			<span className="truncate font-mono min-w-0">{node.name}</span>
			<span className="ml-auto flex items-center gap-2 shrink-0">
				{(node.commentCount ?? 0) > 0 && (
					<span className="inline-flex items-center gap-0.5 text-muted-foreground">
						<MessageSquare className="size-2.5" />
						<span className="text-[10px] tabular-nums">
							{node.commentCount}
						</span>
					</span>
				)}
				<ChangeStatsBar
					additions={node.additions ?? 0}
					deletions={node.deletions ?? 0}
				/>
			</span>
		</button>
	);
}

// ---------------------------------------------------------------------------
// Entry type produced by the entries useMemo in DiffPanel
// ---------------------------------------------------------------------------

type DiffEntry = {
	readonly filename: string;
	readonly previousFilename: string | null;
	readonly patch: string | null;
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
	readonly reviewComments: ReadonlyArray<PrDetail["reviewComments"][number]>;
};

// ---------------------------------------------------------------------------
// FileDiffBlock — memoized per-file diff block
// ---------------------------------------------------------------------------

const FileDiffBlock = memo(function FileDiffBlock({
	entry,
	anchorId,
	isFocused,
	isCollapsed,
	hasCollapsedContext,
	fullContextState,
	viewMode,
	inlineComposerTarget,
	inlineComposerBody,
	isPostingInlineComment,
	inlineCommentResult,
	owner,
	name,
	repositoryId,
	prNumber,
	onToggleCollapse,
	onLoadFullContext,
	onLineSelectionEnd,
	onLineNumberClick,
	onSetInlineComposerTarget,
	onSetInlineComposerBody,
	onSetSelectionNotice,
	onSubmitInlineComment,
	onAddDraftReply,
}: {
	entry: DiffEntry;
	anchorId: string;
	isFocused: boolean;
	isCollapsed: boolean;
	hasCollapsedContext: boolean;
	fullContextState: FullContextDiffState | undefined;
	viewMode: "split" | "unified";
	inlineComposerTarget: InlineReviewCommentTarget | null;
	inlineComposerBody: string;
	isPostingInlineComment: boolean;
	inlineCommentResult: Result.Result<unknown, unknown>;
	owner: string;
	name: string;
	repositoryId: number;
	prNumber: number;
	onToggleCollapse: (filename: string) => void;
	onLoadFullContext: (filename: string) => void;
	onLineSelectionEnd: (
		filename: string,
		range: {
			start: number;
			side?: "deletions" | "additions";
			end: number;
			endSide?: "deletions" | "additions";
		},
	) => void;
	onLineNumberClick: (
		filename: string,
		lineEvent: {
			lineNumber: number;
			annotationSide: "deletions" | "additions";
		},
	) => void;
	onSetInlineComposerTarget: (
		updater: (
			current: InlineReviewCommentTarget | null,
		) => InlineReviewCommentTarget | null,
	) => void;
	onSetInlineComposerBody: (value: string) => void;
	onSetSelectionNotice: (notice: string | null) => void;
	onSubmitInlineComment: () => void;
	onAddDraftReply: (reply: Omit<DraftReviewReply, "id" | "createdAt">) => void;
}) {
	const reviewThreads = buildReviewThreads(entry.reviewComments);

	const inlineAnnotations: Array<DiffLineAnnotation<InlineDiffAnnotation>> =
		inlineComposerTarget !== null &&
		inlineComposerTarget.filename === entry.filename
			? [
					{
						side:
							inlineComposerTarget.side === "LEFT" ? "deletions" : "additions",
						lineNumber: inlineComposerTarget.line,
						metadata: {
							kind: "composer",
							target: inlineComposerTarget,
						},
					},
				]
			: [];

	const fullContextFiles =
		fullContextState?.status === "ready" ? fullContextState.files : null;
	const isLoadingFullContext = fullContextState?.status === "loading";
	const fullContextError =
		fullContextState?.status === "error" ? fullContextState.errorMessage : null;

	const totalChanges = entry.additions + entry.deletions;

	const renderInlineComposer = (
		annotation: DiffLineAnnotation<InlineDiffAnnotation>,
	) => {
		if (annotation.metadata.kind !== "composer") {
			return null;
		}

		return (
			<InlineReviewCommentComposer
				target={annotation.metadata.target}
				body={inlineComposerBody}
				onBodyChange={onSetInlineComposerBody}
				onSubmit={onSubmitInlineComment}
				onCancel={() => {
					onSetInlineComposerTarget(() => null);
					onSetInlineComposerBody("");
					onSetSelectionNotice(null);
				}}
				isSubmitting={isPostingInlineComment}
				errorMessage={
					Result.isFailure(inlineCommentResult)
						? extractInteractionError(
								inlineCommentResult,
								"Could not post inline comment",
							)
						: null
				}
			/>
		);
	};

	const diffOptions: FileDiffOptions<InlineDiffAnnotation> = {
		diffStyle: viewMode,
		disableFileHeader: true,
		hunkSeparators: "line-info",
		expansionLineCount: 10,
		enableLineSelection: true,
		onLineSelectionEnd: (
			range: {
				start: number;
				side?: "deletions" | "additions";
				end: number;
				endSide?: "deletions" | "additions";
			} | null,
		) => {
			if (range === null) {
				return;
			}
			onLineSelectionEnd(entry.filename, range);
		},
		onLineNumberClick: (lineEvent: {
			lineNumber: number;
			annotationSide: "deletions" | "additions";
		}) => {
			if (lineEvent.lineNumber <= 0) return;
			onLineNumberClick(entry.filename, lineEvent);
		},
	};

	return (
		<div
			id={anchorId}
			className={cn(
				"min-w-0 rounded-lg border scroll-mt-36 transition-shadow duration-200",
				isFocused && "ring-1 ring-ring/30 shadow-sm",
			)}
		>
			{/* File header */}
			<div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-t-lg">
				<button
					type="button"
					onClick={() => onToggleCollapse(entry.filename)}
					className="inline-flex size-5 items-center justify-center rounded hover:bg-muted transition-colors"
				>
					<ChevronDown
						className={cn(
							"size-3.5 text-muted-foreground transition-transform duration-150",
							isCollapsed && "-rotate-90",
						)}
					/>
				</button>
				<FileStatusBadge status={entry.status} />
				<span className="font-mono text-[12px] font-medium truncate min-w-0 text-foreground/90">
					{entry.filename}
				</span>
				{entry.previousFilename && entry.status === "renamed" && (
					<span className="text-[10px] text-muted-foreground/50 truncate">
						(from {entry.previousFilename})
					</span>
				)}

				{/* Right side: comment count + stats */}
				<div className="ml-auto flex items-center gap-2.5 shrink-0">
					{hasCollapsedContext && fullContextFiles === null && (
						<Button
							variant="ghost"
							size="icon-sm"
							className="size-5"
							onClick={() => onLoadFullContext(entry.filename)}
							disabled={isLoadingFullContext}
							aria-label="Load full context"
							title="Load full context"
						>
							<Loader2
								className={cn(
									"size-3.5",
									isLoadingFullContext && "animate-spin",
								)}
							/>
						</Button>
					)}
					{entry.reviewComments.length > 0 && (
						<span className="inline-flex items-center gap-1 text-muted-foreground">
							<MessageSquare className="size-3" />
							<span className="text-[10px] tabular-nums">
								{entry.reviewComments.length}
							</span>
						</span>
					)}
					{totalChanges > 0 && (
						<>
							<span className="text-[11px] font-mono tabular-nums text-github-open">
								+{entry.additions}
							</span>
							<span className="text-[11px] font-mono tabular-nums text-github-closed">
								-{entry.deletions}
							</span>
							<ChangeStatsBar
								additions={entry.additions}
								deletions={entry.deletions}
							/>
						</>
					)}
				</div>
			</div>

			{/* Diff content */}
			{!isCollapsed && (
				<>
					{entry.patch !== null ? (
						<div className="overflow-x-auto border-t">
							{fullContextFiles !== null ? (
								<MouseDownExpandContainer
									disabledExpandTooltip={fullContextError ?? undefined}
								>
									<MultiFileDiff
										oldFile={fullContextFiles.oldFile}
										newFile={fullContextFiles.newFile}
										lineAnnotations={[...inlineAnnotations]}
										renderAnnotation={renderInlineComposer}
										options={diffOptions}
									/>
								</MouseDownExpandContainer>
							) : (
								<MouseDownExpandContainer
									disabledExpandTooltip={fullContextError ?? undefined}
								>
									<PatchDiff
										patch={entry.patch}
										lineAnnotations={[...inlineAnnotations]}
										renderAnnotation={renderInlineComposer}
										options={diffOptions}
									/>
								</MouseDownExpandContainer>
							)}
						</div>
					) : (
						<div className="border-t bg-muted/10 px-4 py-4 text-xs text-muted-foreground/60 text-center">
							No inline patch available (binary file or GitHub truncation)
						</div>
					)}

					{/* Review comment threads */}
					{entry.reviewComments.length > 0 && (
						<div className="border-t bg-muted/5 p-3 space-y-2">
							<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2">
								Review threads
							</p>
							{reviewThreads.map((thread) => (
								<ReviewThreadConversation
									key={thread.root.githubReviewCommentId}
									thread={thread}
									ownerLogin={owner}
									name={name}
									repositoryId={repositoryId}
									prNumber={prNumber}
									onAddDraftReply={onAddDraftReply}
								/>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
});

// ---------------------------------------------------------------------------
// Left: Diff / Files Changed
// ---------------------------------------------------------------------------

type DiffPanelHandle = {
	jumpToFile: (filename: string) => void;
};

const DiffPanel = forwardRef<
	DiffPanelHandle,
	{
		pr: PrDetail;
		filesData: FilesData;
		isSyncingFiles: boolean;
		owner: string;
		name: string;
		focusedFilename: string | null;
		onFocusFile: (filename: string | null) => void;
		onAddDraftReply: (
			reply: Omit<DraftReviewReply, "id" | "createdAt">,
		) => void;
	}
>(function DiffPanel(
	{
		pr,
		filesData,
		isSyncingFiles,
		owner,
		name,
		focusedFilename: focusedFilenameProp,
		onFocusFile,
		onAddDraftReply,
	},
	ref,
) {
	const githubActions = useGithubActions();
	const [inlineCommentResult, createInlineComment] = useAtom(
		githubActions.createPrReviewComment.call,
		{ mode: "promise" },
	);
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
	const [inlineComposerTarget, setInlineComposerTarget] =
		useState<InlineReviewCommentTarget | null>(null);
	const [inlineComposerBody, setInlineComposerBody] = useState("");
	const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
	const filterInputRef = useRef<HTMLInputElement>(null);

	const diffPrefKey = `fastergh.diff.preferences.${owner}.${name}`;

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

	useHotkey("Shift+D", (event) => {
		event.preventDefault();
		setViewMode((current) => (current === "split" ? "unified" : "split"));
	});

	useHotkey("Shift+F", (event) => {
		event.preventDefault();
		filterInputRef.current?.focus();
		filterInputRef.current?.select();
	});

	// Stabilise reviewCommentsByPath so entries only recompute when the
	// actual review comment data changes, not on every subscription tick that
	// delivers a structurally identical array with a new reference.
	const reviewCommentsByPathRef = useRef<{
		key: string;
		value: Record<string, Array<PrDetail["reviewComments"][number]>>;
	} | null>(null);
	const reviewCommentsByPath = useMemo(() => {
		const key = JSON.stringify(pr.reviewComments);
		if (
			reviewCommentsByPathRef.current !== null &&
			reviewCommentsByPathRef.current.key === key
		) {
			return reviewCommentsByPathRef.current.value;
		}
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
		reviewCommentsByPathRef.current = { key, value: grouped };
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
	const codeBrowse = useCodeBrowse();
	const [, getFileContent] = useAtom(codeBrowse.getFileContent.call, {
		mode: "promise",
	});
	const [fullContextByFilename, setFullContextByFilename] = useState<
		Record<string, FullContextDiffState>
	>({});

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

	const entriesWithCollapsedContext = useMemo(() => {
		const map: Record<string, boolean> = {};
		for (const entry of entries) {
			map[entry.filename] =
				entry.patch !== null && patchHasCollapsedContext(entry.patch);
		}
		return map;
	}, [entries]);

	const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
	const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
	const totalReviewComments = pr.reviewComments.length;

	// Derived: clamp the parent-provided focusedFilename to a valid entry
	const focusedFilename =
		filteredEntries.length === 0
			? null
			: focusedFilenameProp !== null &&
					filteredEntries.some(
						(entry) => entry.filename === focusedFilenameProp,
					)
				? focusedFilenameProp
				: (filteredEntries[0]?.filename ?? null);

	const fileAnchorId = useCallback(
		(filename: string) => `file-${filename.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
		[],
	);

	const jumpToFile = useCallback(
		(filename: string, options?: { expand?: boolean }) => {
			if (options?.expand === true) {
				setCollapsedFiles((current) => {
					if (current[filename] !== true) return current;
					const next = { ...current };
					delete next[filename];
					return next;
				});
			}

			const target = document.getElementById(fileAnchorId(filename));
			if (target !== null) {
				onFocusFile(filename);
				target.scrollIntoView({ block: "start", behavior: "smooth" });
			}
		},
		[fileAnchorId, onFocusFile],
	);

	useImperativeHandle(ref, () => ({ jumpToFile }), [jumpToFile]);

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
				jumpToFile(nextEntry.filename, { expand: true });
			}
		},
		[filteredEntries, focusedFilename, jumpToFile],
	);

	useHotkey("J", (event) => {
		event.preventDefault();
		moveFocusedFile("next");
	});

	useHotkey("K", (event) => {
		event.preventDefault();
		moveFocusedFile("previous");
	});

	const loadFullContextForFile = useCallback(
		async (filename: string) => {
			let shouldLoad = false;
			setFullContextByFilename((current) => {
				if (current[filename] !== undefined) return current;
				shouldLoad = true;
				return {
					...current,
					[filename]: {
						status: "loading",
						files: null,
						errorMessage: null,
					},
				};
			});

			if (!shouldLoad) return;

			const entry = entries.find(
				(candidate) => candidate.filename === filename,
			);
			if (entry === undefined || entry.patch === null) {
				setFullContextByFilename((current) => ({
					...current,
					[filename]: {
						status: "error",
						files: null,
						errorMessage: "No inline patch available.",
					},
				}));
				return;
			}

			const oldPath = entry.previousFilename ?? entry.filename;
			const needsOld = entry.status !== "added";
			const needsNew = entry.status !== "removed";

			try {
				const oldFile = needsOld
					? await getFileContent({
							ownerLogin: owner,
							name,
							path: oldPath,
							ref: pr.baseRefName,
						})
					: null;
				const newFile = needsNew
					? await getFileContent({
							ownerLogin: owner,
							name,
							path: entry.filename,
							ref: pr.headSha,
						})
					: null;

				if (
					(oldFile !== null && oldFile.content === null) ||
					(newFile !== null && newFile.content === null)
				) {
					setFullContextByFilename((current) => ({
						...current,
						[filename]: {
							status: "error",
							files: null,
							errorMessage:
								"Could not load full context for binary or truncated content.",
						},
					}));
					return;
				}

				const oldFileForDiff = {
					name: oldPath,
					contents: oldFile?.content ?? "",
				};
				const newFileForDiff = {
					name: entry.filename,
					contents: newFile?.content ?? "",
				};

				setFullContextByFilename((current) => ({
					...current,
					[filename]: {
						status: "ready",
						files: {
							oldFile: oldFileForDiff,
							newFile: newFileForDiff,
						},
						errorMessage: null,
					},
				}));
			} catch {
				setFullContextByFilename((current) => ({
					...current,
					[filename]: {
						status: "error",
						files: null,
						errorMessage: "Failed to load full file context.",
					},
				}));
			}
		},
		[entries, getFileContent, name, owner, pr.baseRefName, pr.headSha],
	);

	useEffect(() => {
		if (focusedFilename === null) return;
		if (entriesWithCollapsedContext[focusedFilename] !== true) return;
		if (fullContextByFilename[focusedFilename] !== undefined) return;
		void loadFullContextForFile(focusedFilename);
	}, [
		entriesWithCollapsedContext,
		focusedFilename,
		fullContextByFilename,
		loadFullContextForFile,
	]);

	const submitInlineComment = useCallback(async () => {
		if (inlineComposerTarget === null) return;
		const trimmedBody = inlineComposerBody.trim();
		if (trimmedBody.length === 0) return;

		try {
			await createInlineComment({
				ownerLogin: owner,
				name,
				repositoryId: pr.repositoryId,
				prNumber: pr.number,
				commitSha: pr.headSha,
				body: trimmedBody,
				path: inlineComposerTarget.filename,
				line: inlineComposerTarget.line,
				side: inlineComposerTarget.side,
				startLine:
					inlineComposerTarget.startLine === null
						? undefined
						: inlineComposerTarget.startLine,
				startSide:
					inlineComposerTarget.startSide === null
						? undefined
						: inlineComposerTarget.startSide,
			});
			setInlineComposerBody("");
			setInlineComposerTarget(null);
			setSelectionNotice(null);
		} catch {
			// Error is captured in inlineCommentResult for display
		}
	}, [
		createInlineComment,
		inlineComposerBody,
		inlineComposerTarget,
		name,
		owner,
		pr.headSha,
		pr.number,
		pr.repositoryId,
	]);

	const isPostingInlineComment = Result.isWaiting(inlineCommentResult);

	// Stable callbacks for FileDiffBlock (avoid re-creating per-file closures)
	const handleToggleCollapse = useCallback(
		(filename: string) =>
			setCollapsedFiles((current) => ({
				...current,
				[filename]: !current[filename],
			})),
		[],
	);

	const handleLineSelectionEnd = useCallback(
		(
			filename: string,
			range: {
				start: number;
				side?: "deletions" | "additions";
				end: number;
				endSide?: "deletions" | "additions";
			},
		) => {
			const normalizedRange: DiffSelectedLineRange = {
				start: range.start,
				side: range.side,
				end: range.end,
				endSide: range.endSide,
			};

			const nextTarget = buildInlineTargetFromSelection(
				filename,
				normalizedRange,
			);

			if (nextTarget === null) {
				setSelectionNotice("Could not determine line side for this selection.");
				return;
			}

			const minLine = Math.min(normalizedRange.start, normalizedRange.end);
			const maxLine = Math.max(normalizedRange.start, normalizedRange.end);
			const selectedMultipleLines = minLine !== maxLine;

			if (selectedMultipleLines && nextTarget.startLine !== null) {
				setSelectionNotice(
					`Selected ${filename}:${String(nextTarget.startLine)}-${String(nextTarget.line)} for a multi-line comment.`,
				);
			} else if (selectedMultipleLines) {
				setSelectionNotice(
					"Selection spans both diff sides. Keep the selection on one side for a true multi-line comment.",
				);
			} else {
				setSelectionNotice(null);
			}

			setInlineComposerTarget((current) => {
				if (inlineTargetsEqual(current, nextTarget)) {
					return current;
				}
				setInlineComposerBody("");
				return nextTarget;
			});
		},
		[],
	);

	const handleLineNumberClick = useCallback(
		(
			filename: string,
			lineEvent: {
				lineNumber: number;
				annotationSide: "deletions" | "additions";
			},
		) => {
			if (lineEvent.lineNumber <= 0) return;
			const nextTarget: InlineReviewCommentTarget = {
				filename,
				startLine: null,
				startSide: null,
				line: lineEvent.lineNumber,
				side: lineEvent.annotationSide === "deletions" ? "LEFT" : "RIGHT",
			};

			setSelectionNotice(null);

			setInlineComposerTarget((current) => {
				if (inlineTargetsEqual(current, nextTarget)) {
					setInlineComposerBody("");
					return null;
				}

				setInlineComposerBody("");
				return nextTarget;
			});
		},
		[],
	);

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

	const statusCounts = useMemo(() => {
		const counts = {
			all: files.length,
			added: 0,
			modified: 0,
			removed: 0,
			renamed: 0,
		};
		for (const file of files) {
			if (file.status === "added") counts.added++;
			else if (file.status === "modified" || file.status === "changed")
				counts.modified++;
			else if (file.status === "removed") counts.removed++;
			else if (file.status === "renamed" || file.status === "copied")
				counts.renamed++;
		}
		return counts;
	}, [files]);

	return (
		<div className="p-4 pb-16">
			{/* ── PR Header ── */}
			<div className="flex items-start gap-3 mb-4">
				<PrStateIconLarge state={pr.state} draft={pr.draft} />
				<div className="min-w-0 flex-1">
					<h1 className="text-base font-semibold break-words leading-snug tracking-tight text-foreground">
						{pr.title}
					</h1>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						<span className="font-mono tabular-nums text-muted-foreground/60">
							#{pr.number}
						</span>
						<PrStateBadge
							state={pr.state}
							draft={pr.draft}
							mergedAt={pr.mergedAt}
						/>
						{pr.authorLogin && (
							<span className="inline-flex items-center gap-1.5">
								<Avatar className="size-4">
									<AvatarImage src={pr.authorAvatarUrl ?? undefined} />
									<AvatarFallback className="text-[8px]">
										{pr.authorLogin[0]?.toUpperCase()}
									</AvatarFallback>
								</Avatar>
								<span className="font-medium text-foreground/80">
									{pr.authorLogin}
								</span>
							</span>
						)}
						<span className="text-muted-foreground/30">&middot;</span>
						<span>{formatRelative(pr.githubUpdatedAt)}</span>

						<Separator orientation="vertical" className="mx-0.5 h-4" />

						{/* View mode toggle */}
						<div className="inline-flex items-center rounded-md border bg-muted/30 p-0.5">
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => setViewMode("split")}
										className={cn(
											"inline-flex items-center gap-1.5 rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-all",
											viewMode === "split"
												? "bg-background text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<Columns2 className="size-3.5" />
										Split
									</button>
								</TooltipTrigger>
								<TooltipContent>
									Split diff view <Kbd>Shift</Kbd>+<Kbd>D</Kbd>
								</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => setViewMode("unified")}
										className={cn(
											"inline-flex items-center gap-1.5 rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-all",
											viewMode === "unified"
												? "bg-background text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<Rows3 className="size-3.5" />
										Unified
									</button>
								</TooltipTrigger>
								<TooltipContent>
									Unified diff view <Kbd>Shift</Kbd>+<Kbd>D</Kbd>
								</TooltipContent>
							</Tooltip>
						</div>

						<Separator orientation="vertical" className="mx-0.5 h-4" />

						{/* Status filter pills */}
						<div className="flex items-center gap-0.5">
							{(
								[
									["all", "All", statusCounts.all],
									["modified", "Modified", statusCounts.modified],
									["added", "Added", statusCounts.added],
									["removed", "Removed", statusCounts.removed],
									["renamed", "Renamed", statusCounts.renamed],
								] as const
							).map(([value, label, count]) => (
								<button
									key={value}
									type="button"
									onClick={() => setStatusFilter(value)}
									className={cn(
										"inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
										statusFilter === value
											? "bg-foreground/8 text-foreground"
											: "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50",
										count === 0 &&
											value !== "all" &&
											"opacity-40 pointer-events-none",
									)}
								>
									{label}
									{value !== "all" && count > 0 && (
										<span className="text-[10px] tabular-nums text-muted-foreground/50">
											{count}
										</span>
									)}
								</button>
							))}
						</div>

						<Separator orientation="vertical" className="mx-0.5 h-4" />

						{/* Filter files input */}
						<div className="relative min-w-[140px]">
							<Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/40" />
							<Input
								ref={filterInputRef}
								id={fileFilterInputId}
								value={fileQuery}
								onChange={(event) => setFileQuery(event.target.value)}
								placeholder="Filter files..."
								className="h-6 pl-6 pr-1 text-[11px] border-0 bg-transparent shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/40"
							/>
						</div>
						<span className="text-[10px] text-muted-foreground/50 tabular-nums">
							{filteredEntries.length}/{files.length}
						</span>
						{totalReviewComments > 0 && (
							<span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50">
								<MessageSquare className="size-3" />
								<span className="tabular-nums">{totalReviewComments}</span>
							</span>
						)}
					</div>
				</div>
			</div>

			{/* Description visible on small screens (no right sidebar) */}
			<div className="lg:hidden mb-4">
				{pr.body && <CollapsibleDescription body={pr.body} />}
			</div>

			{/* ── Toolbar ── */}
			<div className="sticky top-0 z-10 mb-4 rounded-lg border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-sm">
				<div className="flex items-center gap-1 px-2.5 py-2">
					{/* Collapse/expand, navigation */}
					<div className="flex items-center gap-0.5">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 w-7 p-0"
									onClick={collapseAllVisibleFiles}
									aria-label="Collapse all files"
								>
									<ChevronsUp className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Collapse all files</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 w-7 p-0"
									onClick={expandAllVisibleFiles}
									aria-label="Expand all files"
								>
									<ChevronsDown className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Expand all files</TooltipContent>
						</Tooltip>

						<Separator orientation="vertical" className="mx-1 h-5" />

						<div className="inline-flex items-center gap-0.5">
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 w-7 p-0"
										onClick={() => moveFocusedFile("previous")}
										disabled={filteredEntries.length === 0}
									>
										<ArrowUp className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									Previous file <Kbd>k</Kbd>
								</TooltipContent>
							</Tooltip>
							<span className="text-[11px] tabular-nums text-muted-foreground min-w-[3ch] text-center">
								{focusedIndex === -1
									? "-"
									: `${focusedIndex + 1}/${filteredEntries.length}`}
							</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 w-7 p-0"
										onClick={() => moveFocusedFile("next")}
										disabled={filteredEntries.length === 0}
									>
										<ArrowDown className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									Next file <Kbd>j</Kbd>
								</TooltipContent>
							</Tooltip>
						</div>
					</div>
				</div>

				{/* Selection notice */}
				{selectionNotice !== null && (
					<div className="border-t px-2.5 py-1.5">
						<p className="text-[11px] text-github-warning">{selectionNotice}</p>
					</div>
				)}
			</div>

			{/* ── Files content ── */}
			{files.length > 0 && (
				<div className="space-y-4">
					{/* Summary bar with stats */}
					<div className="flex items-center gap-3 text-xs">
						<span className="font-medium text-foreground">
							{files.length} file{files.length !== 1 ? "s" : ""} changed
						</span>
						<span className="inline-flex items-center gap-1 text-github-open font-mono tabular-nums">
							+{totalAdditions}
						</span>
						<span className="inline-flex items-center gap-1 text-github-closed font-mono tabular-nums">
							-{totalDeletions}
						</span>
						<ChangeStatsBar
							additions={totalAdditions}
							deletions={totalDeletions}
						/>
					</div>

					{/* Diff blocks */}
					{filteredEntries.length > 0 && (
						<div className="space-y-3">
							{filteredEntries.map((entry) => (
								<FileDiffBlock
									key={entry.filename}
									entry={entry}
									anchorId={fileAnchorId(entry.filename)}
									isFocused={focusedFilename === entry.filename}
									isCollapsed={collapsedFiles[entry.filename] === true}
									hasCollapsedContext={
										entriesWithCollapsedContext[entry.filename] === true
									}
									fullContextState={fullContextByFilename[entry.filename]}
									viewMode={viewMode}
									inlineComposerTarget={inlineComposerTarget}
									inlineComposerBody={inlineComposerBody}
									isPostingInlineComment={isPostingInlineComment}
									inlineCommentResult={inlineCommentResult}
									owner={owner}
									name={name}
									repositoryId={pr.repositoryId}
									prNumber={pr.number}
									onToggleCollapse={handleToggleCollapse}
									onLoadFullContext={loadFullContextForFile}
									onLineSelectionEnd={handleLineSelectionEnd}
									onLineNumberClick={handleLineNumberClick}
									onSetInlineComposerTarget={setInlineComposerTarget}
									onSetInlineComposerBody={setInlineComposerBody}
									onSetSelectionNotice={setSelectionNotice}
									onSubmitInlineComment={submitInlineComment}
									onAddDraftReply={onAddDraftReply}
								/>
							))}
						</div>
					)}
					{filteredEntries.length === 0 && (
						<div className="rounded-lg border bg-muted/5 px-4 py-8 text-center">
							<p className="text-xs text-muted-foreground/60">
								No files match your filter
							</p>
						</div>
					)}
				</div>
			)}

			{/* Loading state */}
			{files.length === 0 && isSyncingFiles && (
				<div className="space-y-3 mt-4">
					<div className="flex items-center gap-2.5 text-xs text-muted-foreground">
						<div className="size-3.5 rounded-full border-2 border-muted-foreground/40 border-t-transparent animate-spin" />
						<span>Syncing file changes...</span>
					</div>
					{[1, 2, 3].map((i) => (
						<div key={i} className="rounded-lg border overflow-hidden">
							<Skeleton className="h-10 w-full rounded-none" />
							<Skeleton className="h-28 w-full rounded-none" />
						</div>
					))}
				</div>
			)}

			{/* Empty state */}
			{files.length === 0 && !isSyncingFiles && (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<div className="size-10 rounded-full border-2 border-dashed border-muted-foreground/15 flex items-center justify-center mb-3">
						<FolderOpen className="size-4 text-muted-foreground/30" />
					</div>
					<p className="text-xs text-muted-foreground/50">
						No file changes synced yet
					</p>
				</div>
			)}
		</div>
	);
});

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

function InlineReviewCommentComposer({
	target,
	body,
	onBodyChange,
	onSubmit,
	onCancel,
	isSubmitting,
	errorMessage,
}: {
	target: InlineReviewCommentTarget;
	body: string;
	onBodyChange: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
	isSubmitting: boolean;
	errorMessage: string | null;
}) {
	const lineRange =
		target.startLine === null
			? String(target.line)
			: `${String(target.startLine)}-${String(target.line)}`;
	const lineLabel = `${target.filename}:${lineRange}${target.side === "LEFT" ? " (old)" : ""}`;

	return (
		<div className="rounded-md border border-github-warning/30 bg-github-warning/10 p-2.5">
			<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-github-warning">
				Inline review comment
			</p>
			<p className="mb-2 text-[11px] text-muted-foreground">{lineLabel}</p>
			<Textarea
				value={body}
				onChange={(event) => onBodyChange(event.target.value)}
				placeholder="Write an inline comment..."
				rows={3}
				className="text-xs"
				disabled={isSubmitting}
			/>
			<div className="mt-2 flex items-center justify-end gap-1.5">
				<Button
					variant="outline"
					size="sm"
					className="h-7 px-2 text-[10px]"
					onClick={onCancel}
					disabled={isSubmitting}
				>
					Cancel
				</Button>
				<Button
					size="sm"
					className="h-7 px-2 text-[10px]"
					onClick={onSubmit}
					disabled={body.trim().length === 0 || isSubmitting}
				>
					{isSubmitting ? "Posting..." : "Post inline comment"}
				</Button>
			</div>
			{errorMessage !== null && (
				<p className="mt-1.5 text-[10px] text-destructive">{errorMessage}</p>
			)}
		</div>
	);
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
	const githubActions = useGithubActions();
	const [replyResult, createReply] = useAtom(
		githubActions.createPrReviewCommentReply.call,
		{ mode: "promise" },
	);
	const [replyBody, setReplyBody] = useState("");
	const [isComposerOpen, setIsComposerOpen] = useState(false);
	const isSubmitting = Result.isWaiting(replyResult);
	const isSuccess = Result.isSuccess(replyResult);

	const submitReply = async () => {
		const trimmedReply = replyBody.trim();
		if (trimmedReply.length === 0) return;

		try {
			await createReply({
				ownerLogin,
				name,
				repositoryId,
				prNumber,
				inReplyToGithubReviewCommentId: thread.root.githubReviewCommentId,
				body: trimmedReply,
			});
			setReplyBody("");
			setIsComposerOpen(false);
		} catch {
			// Error is captured in replyResult for display
		}
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
						<span className="text-[10px] text-github-open">Reply posted</span>
					)}
				</div>

				{isComposerOpen && (
					<div className="mt-2 space-y-1.5 rounded border bg-muted/20 p-2">
						<Textarea
							value={replyBody}
							onChange={(event) => setReplyBody(event.target.value)}
							placeholder="Write an inline reply to this thread..."
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
								{isSubmitting ? "Posting..." : "Post inline reply"}
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
	const [draftBody, setDraftBody] = useState<string | null>(null);
	const isEditing = draftBody !== null;
	const trimmedBody = draftBody?.trim() ?? "";

	return (
		<div className="rounded-md border px-3 py-2">
			<div className="mb-1.5 flex items-center justify-between gap-2">
				<span className="text-xs text-muted-foreground truncate">
					{formatDraftReplyLocation(draftReply)}
				</span>
				<div className="flex items-center gap-1 shrink-0">
					<button
						type="button"
						onClick={() =>
							setDraftBody((current) =>
								current !== null ? null : draftReply.replyBody,
							)
						}
						className="rounded px-1.5 py-0.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer"
					>
						{isEditing ? "Cancel" : "Edit"}
					</button>
					<button
						type="button"
						onClick={onRemove}
						className="rounded px-1.5 py-0.5 text-xs text-muted-foreground/60 hover:text-destructive transition-colors cursor-pointer"
					>
						Remove
					</button>
				</div>
			</div>

			{isEditing ? (
				<div className="space-y-2">
					<Textarea
						value={draftBody}
						onChange={(event) => setDraftBody(event.target.value)}
						rows={3}
						className="text-xs resize-none"
					/>
					<div className="flex justify-end gap-1.5">
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-xs"
							onClick={() => setDraftBody(draftReply.replyBody)}
						>
							Reset
						</Button>
						<Button
							size="sm"
							className="h-7 text-xs"
							disabled={trimmedBody.length === 0}
							onClick={() => {
								onSave(trimmedBody);
								setDraftBody(null);
							}}
						>
							Save
						</Button>
					</div>
				</div>
			) : (
				<p className="line-clamp-3 text-xs leading-relaxed text-foreground">
					{draftReply.replyBody}
				</p>
			)}

			<p className="mt-1.5 text-xs text-muted-foreground/50">
				Queued {formatRelative(draftReply.createdAt)}
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Right sidebar: description, actions, checks, reviews, comments
// ---------------------------------------------------------------------------

function SidebarSection({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return <div className={cn("px-4 py-3", className)}>{children}</div>;
}

function SidebarHeading({
	children,
	count,
}: {
	children: React.ReactNode;
	count?: number;
}) {
	return (
		<h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
			{children}
			{count !== undefined && (
				<span className="text-muted-foreground/50 font-normal tabular-nums">
					{count}
				</span>
			)}
		</h3>
	);
}

function SidebarDivider() {
	return <div className="border-t" />;
}

function InfoSidebar({
	pr,
	owner,
	name,
	prNumber,
	fileTree,
	fileCount,
	focusedFilename,
	onJumpToFile,
	reviewDraftReplies,
	onRemoveDraftReply,
	onUpdateDraftReplyBody,
	onClearDraftReplies,
}: {
	pr: PrDetail;
	owner: string;
	name: string;
	prNumber: number;
	fileTree: Array<FileTreeNode>;
	fileCount: number;
	focusedFilename: string | null;
	onJumpToFile: (filename: string) => void;
	reviewDraftReplies: ReadonlyArray<DraftReviewReply>;
	onRemoveDraftReply: (draftReplyId: string) => void;
	onUpdateDraftReplyBody: (draftReplyId: string, nextBody: string) => void;
	onClearDraftReplies: () => void;
}) {
	const [checkFilter, setCheckFilter] = useState<
		"all" | "failing" | "pending" | "passing"
	>("all");

	const visibleChecks = pr.checkRuns.filter((check) => {
		const matchesStatus =
			checkFilter === "all"
				? true
				: checkFilter === "failing"
					? check.conclusion === "failure"
					: checkFilter === "pending"
						? check.status === "queued" || check.status === "in_progress"
						: check.conclusion === "success";

		return matchesStatus;
	});

	// Deduplicate reviews: keep only the latest review per author
	const latestReviewsByAuthor = (() => {
		const byAuthor = new Map<string, (typeof pr.reviews)[number]>();
		for (const review of pr.reviews) {
			const key =
				review.authorLogin ?? `__unknown_${String(review.githubReviewId)}`;
			const existing = byAuthor.get(key);
			if (
				!existing ||
				(review.submittedAt ?? 0) > (existing.submittedAt ?? 0)
			) {
				byAuthor.set(key, review);
			}
		}
		return [...byAuthor.values()];
	})();

	const visibleReviews = latestReviewsByAuthor;

	const visibleComments = pr.comments;

	const orderedDraftReplies = [...reviewDraftReplies].sort(
		(a, b) => a.createdAt - b.createdAt,
	);

	const checkFilters = [
		{
			value: "all" as const,
			label: "All",
			Icon: ListChecks,
		},
		{
			value: "failing" as const,
			label: "Fail",
			Icon: TriangleAlert,
		},
		{
			value: "pending" as const,
			label: "Pend",
			Icon: Clock,
		},
		{
			value: "passing" as const,
			label: "Pass",
			Icon: CheckCircle2,
		},
	] as const;

	return (
		<div className="flex flex-col divide-y">
			{/* ── Branch & status zone ── */}
			<SidebarSection>
				<div className="flex items-center gap-2 text-xs">
					<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/80 truncate max-w-[40%]">
						{pr.headRefName}
					</code>
					<span className="text-muted-foreground/40 shrink-0">&rarr;</span>
					<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/80 truncate max-w-[40%]">
						{pr.baseRefName}
					</code>
				</div>

				<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
					{pr.mergeableState && (
						<MergeableStateBadge state={pr.mergeableState} />
					)}
					<Badge variant="outline" className="text-xs font-mono">
						{pr.headSha.slice(0, 7)}
					</Badge>
				</div>

				{visibleReviews.length > 0 && (
					<div className="mt-3 space-y-1.5">
						<SidebarHeading>Reviews</SidebarHeading>
						<div className="flex flex-wrap gap-1.5">
							{visibleReviews.map((review) => (
								<ReviewerChip key={review.githubReviewId} review={review} />
							))}
						</div>
					</div>
				)}

				<div className="mt-3">
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
				</div>
			</SidebarSection>

			{/* ── Description ── */}
			{pr.body && (
				<SidebarSection>
					<CollapsibleDescription body={pr.body} />
				</SidebarSection>
			)}

			{/* ── Assignees + Labels ── */}
			<SidebarSection className="space-y-4">
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
			</SidebarSection>

			{/* ── Changed files tree ── */}
			{fileCount > 0 && (
				<SidebarSection>
					<SidebarHeading count={fileCount}>Changed files</SidebarHeading>
					<div className="max-h-72 overflow-y-auto -mx-1">
						{fileTree.map((node) => (
							<FileTreeItem
								key={node.fullPath}
								node={node}
								focusedFilename={focusedFilename}
								onJumpToFile={onJumpToFile}
								depth={0}
							/>
						))}
					</div>
				</SidebarSection>
			)}

			{/* ── Draft replies ── */}
			{orderedDraftReplies.length > 0 && (
				<SidebarSection>
					<div className="flex items-center justify-between mb-2">
						<SidebarHeading count={orderedDraftReplies.length}>
							Draft replies
						</SidebarHeading>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-2 text-xs text-muted-foreground"
							onClick={onClearDraftReplies}
						>
							Clear all
						</Button>
					</div>
					<div className="space-y-2">
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
				</SidebarSection>
			)}

			{/* ── Submit Review ── */}
			{pr.state === "open" && pr.mergedAt === null && (
				<SidebarSection>
					<ReviewSubmitSection
						ownerLogin={owner}
						name={name}
						repositoryId={pr.repositoryId}
						number={prNumber}
						draftReplies={reviewDraftReplies}
						onClearDraftReplies={onClearDraftReplies}
					/>
				</SidebarSection>
			)}

			{/* ── Activity: Checks + Reviews + Comments ── */}
			{(pr.checkRuns.length > 0 ||
				pr.reviews.length > 0 ||
				pr.comments.length > 0) && (
				<>
					{/* Checks */}
					{pr.checkRuns.length > 0 && (
						<SidebarSection>
							<div className="flex items-center justify-between mb-2">
								<SidebarHeading count={visibleChecks.length}>
									Checks
								</SidebarHeading>
								<div className="flex items-center gap-0.5">
									{checkFilters.map(({ value, label, Icon }) => (
										<button
											key={value}
											type="button"
											aria-label={`${label} checks`}
											onClick={() => setCheckFilter(value)}
											title={label}
											className={cn(
												"rounded px-1.5 py-0.5 transition-colors cursor-pointer",
												checkFilter === value
													? "bg-foreground/10 text-foreground font-medium"
													: "text-muted-foreground/60 hover:text-muted-foreground",
											)}
										>
											<Icon className="size-3.5" />
											<span className="sr-only">{label}</span>
										</button>
									))}
								</div>
							</div>
							{visibleChecks.length > 0 ? (
								<div className="rounded-md border divide-y">
									{visibleChecks.map((check) => {
										const internalHref =
											check.runNumber === null
												? null
												: `/${owner}/${name}/actions/runs/${check.runNumber}`;
										const href =
											internalHref ??
											`https://github.com/${owner}/${name}/runs/${String(check.githubCheckRunId)}`;
										const isExternal = internalHref === null;

										return (
											<Link
												key={check.githubCheckRunId}
												href={href}
												target={isExternal ? "_blank" : undefined}
												rel={isExternal ? "noopener noreferrer" : undefined}
												className="flex items-center gap-2 px-2.5 py-2 hover:bg-muted/40 transition-colors group"
											>
												<CheckIcon
													status={check.status}
													conclusion={check.conclusion}
												/>
												<span className="text-xs truncate flex-1 group-hover:underline">
													{check.name}
												</span>
												{isExternal && (
													<ExternalLink className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
												)}
											</Link>
										);
									})}
								</div>
							) : (
								<p className="text-xs text-muted-foreground/60 py-1">
									No checks match filters.
								</p>
							)}
						</SidebarSection>
					)}

					{/* Comments */}
					{pr.comments.length > 0 && (
						<SidebarSection>
							<SidebarHeading count={visibleComments.length}>
								Comments
							</SidebarHeading>
							{visibleComments.length > 0 ? (
								<div className="space-y-2.5">
									{visibleComments.map((comment) => (
										<div
											key={comment.githubCommentId}
											className="rounded-md border"
										>
											<div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
												{comment.authorLogin && (
													<Avatar className="size-5">
														<AvatarImage
															src={comment.authorAvatarUrl ?? undefined}
														/>
														<AvatarFallback className="text-[9px]">
															{comment.authorLogin[0]?.toUpperCase()}
														</AvatarFallback>
													</Avatar>
												)}
												<span className="text-xs font-medium">
													{comment.authorLogin ?? "Unknown"}
												</span>
												<span className="text-xs text-muted-foreground/50 tabular-nums ml-auto">
													{formatRelative(comment.createdAt)}
												</span>
											</div>
											<div className="px-3 py-2">
												<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-xs leading-relaxed">
													<MarkdownBody>{comment.body}</MarkdownBody>
												</div>
											</div>
										</div>
									))}
								</div>
							) : (
								<p className="text-xs text-muted-foreground/60 py-1">
									No comments match filters.
								</p>
							)}
						</SidebarSection>
					)}
				</>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Collapsible description — shows a preview with expand toggle
// ---------------------------------------------------------------------------

/**
 * Strip HTML/markdown comments (`<!-- ... -->`) and trim.
 * Returns the cleaned string so we can decide whether there's any visible
 * content worth rendering.
 */
function stripHtmlComments(text: string): string {
	return text.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function CollapsibleDescription({ body }: { body: string }) {
	const [expanded, setExpanded] = useState(false);
	const visibleBody = stripHtmlComments(body);

	if (visibleBody.length === 0) return null;

	return (
		<div>
			<div
				className={cn(
					"prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-xs leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_h2]:text-sm [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:text-xs [&_h3]:mt-2.5 [&_h3]:mb-1 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0 [&_:not(pre)>code]:text-[0.85em]",
					!expanded && "max-h-28 overflow-hidden",
				)}
			>
				<MarkdownBody>{visibleBody}</MarkdownBody>
			</div>
			<button
				type="button"
				onClick={() => setExpanded((prev) => !prev)}
				className="flex w-full items-center justify-center gap-1 mt-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer"
			>
				<ChevronDown
					className={cn(
						"size-3 transition-transform duration-200",
						expanded && "rotate-180",
					)}
				/>
				{expanded ? "Show less" : "Show more"}
			</button>
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
	const onDemandSync = useOnDemandSync();
	const [mergeResult, doMerge] = useAtom(writeClient.mergePullRequest.call);
	const [syncPullRequestResult, syncPullRequest] = useAtom(
		onDemandSync.syncPullRequest.call,
	);
	const [branchUpdateResult, doUpdateBranch] = useAtom(
		writeClient.updatePullRequestBranch.call,
	);
	const [stateResult, doUpdateState] = useAtom(
		writeClient.updateIssueState.call,
	);
	const correlationPrefix = useId();
	const hasRequestedMergeabilityRefresh = useRef(false);
	const isMerging = Result.isWaiting(mergeResult);
	const isSyncingPullRequest = Result.isWaiting(syncPullRequestResult);
	const isUpdatingBranch = Result.isWaiting(branchUpdateResult);
	const isUpdatingState = Result.isWaiting(stateResult);

	const normalizedMergeableState = mergeableState?.trim().toLowerCase() ?? null;
	const isMergeable =
		state === "open" &&
		!draft &&
		(normalizedMergeableState === "clean" ||
			normalizedMergeableState === "unstable");
	const canUpdateBranch =
		state === "open" && normalizedMergeableState === "behind";

	useEffect(() => {
		if (state !== "open" || draft || normalizedMergeableState !== null) {
			hasRequestedMergeabilityRefresh.current = false;
			return;
		}
		if (hasRequestedMergeabilityRefresh.current) return;
		hasRequestedMergeabilityRefresh.current = true;
		syncPullRequest({
			ownerLogin,
			name,
			number,
			force: true,
		});
	}, [
		draft,
		name,
		normalizedMergeableState,
		number,
		ownerLogin,
		state,
		syncPullRequest,
	]);

	if (mergedAt !== null) return null;

	const mergeDisabledReason = isMerging
		? "Merge in progress"
		: state !== "open"
			? "Only open pull requests can be merged"
			: draft
				? "Draft pull requests cannot be merged"
				: normalizedMergeableState === null
					? isSyncingPullRequest
						? "Refreshing mergeability from GitHub"
						: "Mergeability is still being calculated"
					: normalizedMergeableState === "behind"
						? "Branch is behind base branch"
						: normalizedMergeableState === "dirty"
							? "This pull request has merge conflicts"
							: normalizedMergeableState === "blocked"
								? "This pull request is blocked from merging"
								: isMergeable
									? null
									: `Merge unavailable (${mergeableState})`;
	const isMergeButtonDisabled = mergeDisabledReason !== null;

	const hasError =
		Result.isFailure(mergeResult) ||
		Result.isFailure(branchUpdateResult) ||
		Result.isFailure(stateResult) ||
		Result.isFailure(syncPullRequestResult);

	const mergeButton = (
		<Button
			size="sm"
			disabled={isMergeButtonDisabled}
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
				"h-8 text-xs flex-1",
				isMergeable &&
					"bg-github-open hover:bg-github-open/90 text-primary-foreground",
			)}
		>
			{isMerging ? "Merging..." : "Merge pull request"}
		</Button>
	);

	return (
		<div className="space-y-2">
			{canUpdateBranch && (
				<Button
					variant="outline"
					size="sm"
					disabled={isUpdatingBranch}
					className="h-8 text-xs w-full"
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
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						disabled={isUpdatingState}
						className="h-8 text-xs text-muted-foreground flex-1"
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
					{mergeDisabledReason === null ? (
						mergeButton
					) : (
						<Tooltip>
							<TooltipTrigger asChild>
								<span className="block flex-1 cursor-not-allowed">
									{mergeButton}
								</span>
							</TooltipTrigger>
							<TooltipContent>{mergeDisabledReason}</TooltipContent>
						</Tooltip>
					)}
				</div>
			)}

			{state === "closed" && (
				<Button
					variant="outline"
					size="sm"
					disabled={isUpdatingState}
					className="h-8 text-xs w-full"
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

			{hasError && (
				<p className="text-xs text-destructive">
					{Result.isFailure(syncPullRequestResult) &&
						"Could not refresh mergeability. "}
					{Result.isFailure(mergeResult) && "Merge failed. "}
					{Result.isFailure(branchUpdateResult) && "Branch update failed. "}
					{Result.isFailure(stateResult) && "State update failed."}
				</p>
			)}
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
		writeClient.submitPrReview.call,
		{ mode: "promise" },
	);
	const [body, setBody] = useState("");
	const correlationPrefix = useId();
	const [selectedEvent, setSelectedEvent] = useState<
		"APPROVE" | "REQUEST_CHANGES" | "COMMENT"
	>("COMMENT");
	const [pendingEvent, setPendingEvent] = useState<
		"APPROVE" | "REQUEST_CHANGES" | "COMMENT" | null
	>(null);
	const [includeDraftReplies, setIncludeDraftReplies] = useState(true);
	const [showDraftPreview, setShowDraftPreview] = useState(false);
	const isSubmitting = Result.isWaiting(reviewResult);
	const isSuccess = Result.isSuccess(reviewResult);

	// Re-include drafts when new ones arrive (tracks previous count to detect additions)
	const prevDraftCountRef = useRef(draftReplies.length);
	if (draftReplies.length > prevDraftCountRef.current) {
		setIncludeDraftReplies(true);
	}
	prevDraftCountRef.current = draftReplies.length;

	const handleSubmit = async () => {
		const event = selectedEvent;
		const trimmedBody = body.trim();
		const draftMarkdown = renderDraftRepliesMarkdown(
			includeDraftReplies ? draftReplies : [],
		);
		const finalBody = [trimmedBody, draftMarkdown]
			.filter((section) => section.length > 0)
			.join("\n\n");

		setPendingEvent(event);
		try {
			await submitReview({
				correlationId: `${correlationPrefix}-review-${Date.now()}`,
				ownerLogin,
				name,
				repositoryId,
				number,
				event,
				body: finalBody.length > 0 ? finalBody : undefined,
			});
			setBody("");
			setPendingEvent(null);
			setShowDraftPreview(false);
			onClearDraftReplies();
		} catch {
			setPendingEvent(null);
		}
	};

	const reviewOptions = [
		{ value: "COMMENT" as const, label: "Comment", dot: "bg-muted-foreground" },
		{ value: "APPROVE" as const, label: "Approve", dot: "bg-github-open" },
		{
			value: "REQUEST_CHANGES" as const,
			label: "Request changes",
			dot: "bg-github-warning",
		},
	];

	const submitLabel =
		selectedEvent === "APPROVE"
			? "Submit approval"
			: selectedEvent === "REQUEST_CHANGES"
				? "Request changes"
				: "Submit comment";

	return (
		<div>
			<SidebarHeading>Submit review</SidebarHeading>
			{draftReplies.length > 0 && (
				<div className="mb-2.5">
					<div className="flex items-center justify-between gap-2">
						<span className="text-[11px] text-muted-foreground/70 tabular-nums">
							{draftReplies.length} pending{" "}
							{draftReplies.length === 1 ? "reply" : "replies"}
						</span>
						<div className="flex items-center gap-0.5">
							<button
								type="button"
								onClick={() => setIncludeDraftReplies((current) => !current)}
								className={cn(
									"rounded px-1.5 py-0.5 text-[11px] transition-colors cursor-pointer",
									includeDraftReplies
										? "text-foreground/80"
										: "text-muted-foreground/40 line-through",
								)}
							>
								{includeDraftReplies ? "include" : "skip"}
							</button>
							<span className="text-muted-foreground/20">|</span>
							<button
								type="button"
								onClick={() => setShowDraftPreview((current) => !current)}
								className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
							>
								{showDraftPreview ? "hide" : "preview"}
							</button>
						</div>
					</div>
					{showDraftPreview && (
						<div className="mt-1.5 rounded border bg-muted/30 p-2.5">
							<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-xs leading-relaxed">
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
				placeholder="Leave a comment..."
				value={body}
				onChange={(e) => setBody(e.target.value)}
				rows={2}
				disabled={isSubmitting}
				className="text-xs resize-none"
			/>
			<div className="mt-2 space-y-1">
				{reviewOptions.map((opt) => (
					<label
						key={opt.value}
						className={cn(
							"flex items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer transition-colors",
							selectedEvent === opt.value
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:text-foreground hover:bg-accent/50",
						)}
					>
						<input
							type="radio"
							name="review-event"
							value={opt.value}
							checked={selectedEvent === opt.value}
							onChange={() => setSelectedEvent(opt.value)}
							className="sr-only"
						/>
						<span
							className={cn(
								"size-2 rounded-full shrink-0 transition-opacity",
								opt.dot,
								selectedEvent === opt.value ? "opacity-100" : "opacity-40",
							)}
						/>
						{opt.label}
					</label>
				))}
			</div>
			<Button
				size="sm"
				variant="outline"
				className="mt-2 h-7 w-full text-xs"
				disabled={isSubmitting}
				onClick={() => handleSubmit()}
			>
				{isSubmitting && pendingEvent !== null ? "Submitting..." : submitLabel}
			</Button>
			{Result.isFailure(reviewResult) && (
				<p className="mt-1.5 text-[11px] text-destructive">
					{extractInteractionError(reviewResult, "Could not submit review")}
				</p>
			)}
			{isSuccess && (
				<p className="mt-1.5 text-[11px] text-github-open">Review submitted.</p>
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
				className="mt-1 size-5 text-github-open shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
			</svg>
		);
	return (
		<svg
			className="mt-1 size-5 text-github-merged shrink-0"
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
			<Badge className="bg-github-merged hover:bg-github-merged/90 text-xs">
				Merged
			</Badge>
		);
	if (draft)
		return (
			<Badge variant="outline" className="text-xs">
				Draft
			</Badge>
		);
	if (state === "open")
		return (
			<Badge className="bg-github-open hover:bg-github-open/90 text-xs">
				Open
			</Badge>
		);
	return (
		<Badge variant="secondary" className="text-xs">
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
			className: "text-github-open",
		},
		dirty: { label: "Has conflicts", variant: "destructive" },
		blocked: { label: "Blocked", variant: "outline" },
		unstable: {
			label: "Unstable",
			variant: "outline",
			className: "text-github-warning",
		},
		behind: {
			label: "Behind base",
			variant: "outline",
			className: "text-github-warning",
		},
	};
	const c = config[state] ?? { label: state, variant: "outline" as const };
	return (
		<Badge variant={c.variant} className={cn("text-xs", c.className)}>
			{c.label}
		</Badge>
	);
}

/**
 * Compact chip showing a reviewer's avatar with a small colored status dot.
 * Tooltip reveals the full name, state, and relative time on hover.
 */
function ReviewerChip({
	review,
}: {
	review: {
		readonly githubReviewId: number;
		readonly authorLogin: string | null;
		readonly authorAvatarUrl: string | null;
		readonly state: string;
		readonly submittedAt: number | null;
		readonly optimisticState: "pending" | "failed" | "confirmed" | null;
		readonly optimisticErrorMessage: string | null;
	};
}) {
	const stateConfig: Record<string, { dotClass: string; label: string }> = {
		APPROVED: {
			dotClass: "bg-github-open",
			label: "Approved",
		},
		CHANGES_REQUESTED: {
			dotClass: "bg-github-closed",
			label: "Changes requested",
		},
		COMMENTED: {
			dotClass: "bg-muted-foreground",
			label: "Commented",
		},
		DISMISSED: {
			dotClass: "bg-muted-foreground/50",
			label: "Dismissed",
		},
		PENDING: {
			dotClass: "border border-muted-foreground bg-transparent",
			label: "Pending",
		},
	};
	const normalizedState = normalizeReviewState(review.state);
	const config = stateConfig[normalizedState] ?? {
		dotClass: "bg-muted-foreground",
		label: review.state,
	};

	const tooltipLabel = [
		review.authorLogin ?? "Unknown",
		config.label,
		review.submittedAt ? formatRelative(review.submittedAt) : null,
	]
		.filter(Boolean)
		.join(" \u00B7 ");

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="relative inline-flex shrink-0">
					<Avatar className="size-6">
						<AvatarImage src={review.authorAvatarUrl ?? undefined} />
						<AvatarFallback className="text-[10px]">
							{(review.authorLogin ?? "?")[0]?.toUpperCase()}
						</AvatarFallback>
					</Avatar>
					{/* Status dot */}
					<span
						className={cn(
							"absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
							config.dotClass,
						)}
					/>
					{/* Optimistic indicator */}
					{review.optimisticState === "pending" && (
						<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-github-warning ring-1 ring-background animate-pulse" />
					)}
					{review.optimisticState === "failed" && (
						<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-github-closed ring-1 ring-background" />
					)}
				</div>
			</TooltipTrigger>
			<TooltipContent>{tooltipLabel}</TooltipContent>
		</Tooltip>
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
			className: "text-github-open",
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
	const normalizedState = normalizeReviewState(state);
	const c = config[normalizedState] ?? {
		label: state,
		variant: "outline" as const,
	};
	return (
		<Badge variant={c.variant} className={cn("text-xs", c.className)}>
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
			<Badge variant="destructive" className="text-xs">
				{optimisticErrorMessage ?? "Rejected"}
			</Badge>
		);
	}
	if (optimisticState === "pending") {
		return (
			<Badge variant="outline" className="text-xs">
				Syncing
			</Badge>
		);
	}
	if (optimisticState === "confirmed") {
		return (
			<Badge variant="secondary" className="text-xs text-github-open">
				Confirmed
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
				className="size-3.5 text-github-open"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
			</svg>
		);
	if (conclusion === "failure")
		return (
			<svg
				className="size-3.5 text-github-closed"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
			</svg>
		);
	if (status === "in_progress")
		return (
			<div className="size-3.5 rounded-full border-2 border-github-warning border-t-transparent animate-spin" />
		);
	return (
		<div className="size-3.5 rounded-full border-2 border-muted-foreground" />
	);
}

function FileStatusBadge({ status }: { status: string }) {
	const config: Record<string, { label: string; className: string }> = {
		added: {
			label: "A",
			className: "bg-github-open/15 text-github-open",
		},
		removed: {
			label: "D",
			className: "bg-github-closed/15 text-github-closed",
		},
		modified: {
			label: "M",
			className: "bg-github-warning/15 text-github-warning",
		},
		renamed: {
			label: "R",
			className: "bg-github-info/15 text-github-info",
		},
	};
	const c = config[status] ?? { label: "?", className: "bg-muted" };
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
