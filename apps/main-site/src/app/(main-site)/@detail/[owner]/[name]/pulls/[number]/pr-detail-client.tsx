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
import { Separator } from "@packages/ui/components/separator";
import { Skeleton } from "@packages/ui/components/skeleton";
import { Textarea } from "@packages/ui/components/textarea";
import { cn } from "@packages/ui/lib/utils";
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { PatchDiff } from "@pierre/diffs/react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { MarkdownBody } from "@/components/markdown-body";

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
	}[];
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
					prNumber={prNumber}
				/>
			</div>

			{/* Right sidebar: description, metadata, reviews, comments */}
			<div className="hidden lg:flex w-80 xl:w-96 shrink-0 border-l border-border/60 h-full flex-col overflow-y-auto bg-muted/20">
				<InfoSidebar pr={pr} owner={owner} name={name} prNumber={prNumber} />
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
	prNumber,
}: {
	pr: PrDetail;
	filesData: FilesData;
	isSyncingFiles: boolean;
	owner: string;
	name: string;
	prNumber: number;
}) {
	const files = filesData.files;
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
											options={{
												diffStyle: "unified",
												disableFileHeader: true,
											}}
										/>
									</div>
								</div>
							))}
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

// ---------------------------------------------------------------------------
// Right sidebar: description, actions, checks, reviews, comments
// ---------------------------------------------------------------------------

function InfoSidebar({
	pr,
	owner,
	name,
	prNumber,
}: {
	pr: PrDetail;
	owner: string;
	name: string;
	prNumber: number;
}) {
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

			{/* Body / Description */}
			{pr.body && <CollapsibleDescription body={pr.body} />}

			{/* Check runs */}
			{pr.checkRuns.length > 0 && (
				<div>
					<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
						Checks <span className="font-normal">({pr.checkRuns.length})</span>
					</h3>
					<div className="divide-y rounded-md border">
						{pr.checkRuns.map((check) => (
							<a
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
							</a>
						))}
					</div>
				</div>
			)}

			{/* Reviews */}
			{pr.reviews.length > 0 && (
				<div>
					<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
						Reviews <span className="font-normal">({pr.reviews.length})</span>
					</h3>
					<div className="space-y-1">
						{pr.reviews.map((review) => (
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
								{review.submittedAt && (
									<span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
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
				<div>
					<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
						Comments <span className="font-normal">({pr.comments.length})</span>
					</h3>
					<div className="space-y-2">
						{pr.comments.map((comment) => (
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
		<div className="flex flex-wrap items-center gap-2">
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
