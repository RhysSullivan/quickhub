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
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useOnDemandSync } from "@packages/ui/rpc/on-demand-sync";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { PatchDiff } from "@pierre/diffs/react";
import { use, useId, useMemo, useState } from "react";
import { MarkdownBody } from "@/components/markdown-body";

// ---------------------------------------------------------------------------
// Types — inferred from the server RPC return types
// ---------------------------------------------------------------------------

import type { serverQueries } from "@/lib/server-queries";

type PrDetail = NonNullable<
	Awaited<
		ReturnType<(typeof serverQueries)["getPullRequestDetail"]["queryPromise"]>
	>
>;

type FilesData = Awaited<
	ReturnType<(typeof serverQueries)["listPrFiles"]["queryPromise"]>
>;

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

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

// ---------------------------------------------------------------------------
// PR detail client component
// ---------------------------------------------------------------------------

export function PullRequestDetailClient({
	owner,
	name,
	prNumber,
	initialDataPromise,
}: {
	owner: string;
	name: string;
	prNumber: number;
	initialDataPromise: Promise<PrDetail | null>;
}) {
	// use() suspends until the server-fetched promise resolves
	const initialData = use(initialDataPromise);

	// Real-time subscription — falls back to server data until connected
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
	const pr = useSubscriptionWithInitial(prAtom, initialData);

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
			<div className="flex items-start gap-2 sm:gap-3">
				<PrStateIcon state={pr.state} draft={pr.draft} />
				<div className="min-w-0 flex-1">
					<h1 className="text-xl sm:text-2xl font-bold break-words">
						{pr.title}
					</h1>
					<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
						<span>#{pr.number}</span>
						<PrStateBadge
							state={pr.state}
							draft={pr.draft}
							mergedAt={pr.mergedAt}
						/>
						{pr.authorLogin && (
							<span className="flex items-center gap-1">
								<Avatar className="size-5">
									<AvatarImage src={pr.authorAvatarUrl ?? undefined} />
									<AvatarFallback className="text-[10px]">
										{pr.authorLogin[0]?.toUpperCase()}
									</AvatarFallback>
								</Avatar>
								<span className="font-medium text-foreground">
									{pr.authorLogin}
								</span>
							</span>
						)}
					</div>
					<div className="mt-1.5 text-sm text-muted-foreground">
						<span className="inline-flex flex-wrap items-center gap-1">
							<span className="shrink-0">merge</span>
							<code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono break-all">
								{pr.headRefName}
							</code>
							<span className="shrink-0">into</span>
							<code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono break-all">
								{pr.baseRefName}
							</code>
						</span>
					</div>
				</div>
			</div>

			{/* Metadata bar */}
			<div className="mt-3 sm:mt-4 flex flex-wrap gap-2">
				{pr.mergeableState && <MergeableStateBadge state={pr.mergeableState} />}
				<Badge variant="outline" className="text-xs font-mono">
					{pr.headSha.slice(0, 7)}
				</Badge>
				<span className="text-sm text-muted-foreground">
					Updated {formatRelative(pr.githubUpdatedAt)}
				</span>
			</div>

			{/* Body */}
			{pr.body && (
				<Card className="mt-4 sm:mt-6">
					<CardContent className="px-3 pt-4 sm:px-6 sm:pt-6">
						<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto">
							<MarkdownBody>{pr.body}</MarkdownBody>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Action bar — merge / close / reopen */}
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

			{/* Check runs */}
			{pr.checkRuns.length > 0 && (
				<div className="mt-6 sm:mt-8">
					<h2 className="text-lg font-semibold mb-3 sm:mb-4">
						Checks ({pr.checkRuns.length})
					</h2>
					<Card>
						<CardContent className="px-3 pt-3 sm:px-6 sm:pt-4">
							<div className="divide-y">
								{pr.checkRuns.map((check) => (
									<div
										key={check.name}
										className="flex items-center justify-between gap-2 py-2"
									>
										<div className="flex items-center gap-2 min-w-0">
											<CheckIcon
												status={check.status}
												conclusion={check.conclusion}
											/>
											<span className="text-sm font-medium truncate">
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
												className={`shrink-0 ${
													check.conclusion === "success" ? "text-green-600" : ""
												}`}
											>
												{check.conclusion}
											</Badge>
										)}
										{!check.conclusion && check.status === "in_progress" && (
											<Badge variant="outline" className="shrink-0">
												In progress
											</Badge>
										)}
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				</div>
			)}

			{/* Reviews */}
			{pr.reviews.length > 0 && (
				<div className="mt-6 sm:mt-8">
					<h2 className="text-lg font-semibold mb-3 sm:mb-4">
						Reviews ({pr.reviews.length})
					</h2>
					<div className="space-y-2 sm:space-y-3">
						{pr.reviews.map((review) => (
							<div
								key={review.githubReviewId}
								className="flex flex-wrap items-center gap-2 sm:gap-3 rounded-lg border px-3 py-2.5 sm:px-4 sm:py-3"
							>
								{review.authorLogin && (
									<Avatar className="size-5 sm:size-6">
										<AvatarImage src={review.authorAvatarUrl ?? undefined} />
										<AvatarFallback className="text-[10px]">
											{review.authorLogin[0]?.toUpperCase()}
										</AvatarFallback>
									</Avatar>
								)}
								<span className="text-sm font-medium truncate">
									{review.authorLogin ?? "Unknown"}
								</span>
								<ReviewStateBadge state={review.state} />
								<ReviewOptimisticBadge
									optimisticState={review.optimisticState}
									optimisticErrorMessage={review.optimisticErrorMessage}
								/>
								{review.submittedAt && (
									<span className="text-xs text-muted-foreground">
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
				<div className="mt-6 sm:mt-8">
					<h2 className="text-lg font-semibold mb-3 sm:mb-4">
						{pr.comments.length} Comment
						{pr.comments.length !== 1 ? "s" : ""}
					</h2>
					<div className="space-y-3 sm:space-y-4">
						{pr.comments.map((comment) => (
							<Card key={comment.githubCommentId}>
								<CardHeader className="px-3 pb-2 sm:px-6">
									<div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-sm">
										{comment.authorLogin && (
											<span className="flex items-center gap-1.5">
												<Avatar className="size-5">
													<AvatarImage
														src={comment.authorAvatarUrl ?? undefined}
													/>
													<AvatarFallback className="text-[10px]">
														{comment.authorLogin[0]?.toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<span className="font-medium">
													{comment.authorLogin}
												</span>
											</span>
										)}
										<span className="text-xs sm:text-sm text-muted-foreground">
											{formatRelative(comment.createdAt)}
										</span>
									</div>
								</CardHeader>
								<CardContent className="px-3 sm:px-6">
									<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto">
										<MarkdownBody>{comment.body}</MarkdownBody>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			)}

			{pr.comments.length === 0 && pr.reviews.length === 0 && (
				<p className="mt-6 sm:mt-8 text-sm text-muted-foreground">
					No comments or reviews yet.
				</p>
			)}

			{/* Comment form */}
			<Separator className="mt-6 sm:mt-8" />
			<CommentForm
				ownerLogin={owner}
				name={name}
				number={prNumber}
				repositoryId={pr.repositoryId}
			/>
		</>
	);
}

// ---------------------------------------------------------------------------
// Files changed client component
// ---------------------------------------------------------------------------

export function FilesChangedClient({
	owner,
	name,
	prNumber,
	initialDataPromise,
}: {
	owner: string;
	name: string;
	prNumber: number;
	initialDataPromise: Promise<FilesData>;
}) {
	// use() suspends until the server-fetched promise resolves
	const initialData = use(initialDataPromise);

	// Real-time subscription — falls back to server data until connected
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
	const filesData = useSubscriptionWithInitial(filesAtom, initialData);

	const isSyncingFiles = filesData.files.length === 0;

	const files = filesData.files;

	// Build per-file patches — PatchDiff expects exactly 1 file per patch string
	const filePatchEntries = useMemo(() => {
		const entries: Array<{
			filename: string;
			patch: string;
			status: (typeof files)[number]["status"];
			additions: number;
			deletions: number;
		}> = [];
		for (const file of files) {
			if (file.patch === null) continue;
			const oldName = file.previousFilename ?? file.filename;
			const singlePatch = [
				`diff --git a/${oldName} b/${file.filename}`,
				`--- a/${oldName}`,
				`+++ b/${file.filename}`,
				file.patch,
			].join("\n");
			entries.push({
				filename: file.filename,
				patch: singlePatch,
				status: file.status,
				additions: file.additions,
				deletions: file.deletions,
			});
		}
		return entries;
	}, [files]);

	// File summary stats
	const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
	const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

	return (
		<div className="mt-6 sm:mt-8">
			<div className="flex items-center justify-between mb-3 sm:mb-4">
				<h2 className="text-lg font-semibold">
					Files Changed
					{files.length > 0 && (
						<span className="ml-2 text-sm font-normal text-muted-foreground">
							{files.length} file{files.length !== 1 ? "s" : ""}
							{totalAdditions > 0 && (
								<span className="text-green-600 ml-2">+{totalAdditions}</span>
							)}
							{totalDeletions > 0 && (
								<span className="text-red-600 ml-1">-{totalDeletions}</span>
							)}
						</span>
					)}
				</h2>
			</div>

			{files.length === 0 && isSyncingFiles && (
				<div className="space-y-4">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<div className="size-4 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" />
						<span>Loading file changes...</span>
					</div>
					{[1, 2, 3].map((i) => (
						<div key={i}>
							<Skeleton className="h-10 w-full rounded-t-lg rounded-b-none" />
							<Skeleton className="h-32 w-full rounded-t-none rounded-b-lg" />
						</div>
					))}
				</div>
			)}

			{files.length === 0 && !isSyncingFiles && (
				<Card>
					<CardContent className="px-3 pt-4 sm:px-6 sm:pt-6">
						<p className="text-sm text-muted-foreground">
							No file changes synced yet. Changes will appear automatically when
							the diff data is available.
						</p>
					</CardContent>
				</Card>
			)}

			{filePatchEntries.length > 0 && (
				<div className="space-y-3">
					{filePatchEntries.map((entry) => (
						<div key={entry.filename} className="min-w-0">
							<div className="flex items-center gap-2 px-2 py-1.5 sm:px-3 sm:py-2 bg-muted/50 rounded-t-lg border border-b-0 text-xs">
								<FileStatusBadge status={entry.status} />
								<span className="font-mono font-medium truncate min-w-0">
									{entry.filename}
								</span>
								<span className="ml-auto flex gap-2 shrink-0">
									<span className="text-green-600">+{entry.additions}</span>
									<span className="text-red-600">-{entry.deletions}</span>
								</span>
							</div>
							<div className="overflow-x-auto rounded-b-lg border">
								<PatchDiff
									patch={entry.patch}
									options={{ diffStyle: "unified" }}
								/>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Files with no patch (too large) */}
			{files.some((f) => f.patch === null) && (
				<div className="mt-4">
					<p className="text-xs text-muted-foreground mb-2">
						Some files are too large to display inline:
					</p>
					<div className="space-y-1">
						{files
							.filter((f) => f.patch === null)
							.map((f) => (
								<div
									key={f.filename}
									className="flex items-center gap-2 text-xs text-muted-foreground min-w-0"
								>
									<FileStatusBadge status={f.status} />
									<span className="font-mono truncate min-w-0">
										{f.filename}
									</span>
									<span className="shrink-0 text-green-600">
										+{f.additions}
									</span>
									<span className="shrink-0 text-red-600">-{f.deletions}</span>
								</div>
							))}
					</div>
				</div>
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
		<div className="mt-6">
			<h3 className="text-sm font-semibold mb-2">Add a comment</h3>
			<Textarea
				placeholder="Leave a comment..."
				value={body}
				onChange={(e) => setBody(e.target.value)}
				rows={4}
				disabled={isSubmitting}
				className="mb-3"
			/>
			<div className="flex items-center justify-between">
				<div>
					{Result.isFailure(commentResult) && (
						<p className="text-sm text-destructive">
							Failed to submit comment. Please try again.
						</p>
					)}
					{Result.isSuccess(commentResult) && body === "" && (
						<p className="text-sm text-green-600">Comment submitted!</p>
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

// ---------------------------------------------------------------------------
// PR action bar — merge / close / reopen
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

	// Don't show actions for already-merged PRs
	if (mergedAt !== null) return null;

	const isMergeable =
		state === "open" &&
		!draft &&
		(mergeableState === "clean" || mergeableState === "unstable");
	const canUpdateBranch = state === "open" && mergeableState === "behind";

	return (
		<Card className="mt-4 sm:mt-6">
			<CardContent className="px-3 pt-3 sm:px-6 sm:pt-4">
				<div className="flex flex-wrap items-center gap-2 sm:gap-3">
					{/* Update branch button */}
					{canUpdateBranch && (
						<Button
							variant="outline"
							size="sm"
							disabled={isUpdatingBranch}
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
							{isUpdatingBranch ? "Updating branch..." : "Update branch"}
						</Button>
					)}

					{/* Merge button */}
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
							className={
								isMergeable ? "bg-green-600 hover:bg-green-700 text-white" : ""
							}
						>
							{isMerging ? "Merging..." : "Merge pull request"}
						</Button>
					)}

					{/* Close / Reopen */}
					{state === "open" && (
						<Button
							variant="outline"
							size="sm"
							disabled={isUpdatingState}
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
							{isUpdatingState ? "Closing..." : "Close pull request"}
						</Button>
					)}

					{state === "closed" && (
						<Button
							variant="outline"
							size="sm"
							disabled={isUpdatingState}
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
							{isUpdatingState ? "Reopening..." : "Reopen pull request"}
						</Button>
					)}
				</div>

				{/* Feedback messages + status hints below buttons */}
				{Result.isFailure(mergeResult) && (
					<p className="mt-2 text-sm text-destructive">
						Merge failed. Please try again.
					</p>
				)}
				{Result.isFailure(branchUpdateResult) && (
					<p className="mt-2 text-sm text-destructive">
						Branch update failed. Please try again.
					</p>
				)}
				{Result.isFailure(stateResult) && (
					<p className="mt-2 text-sm text-destructive">
						State update failed. Please try again.
					</p>
				)}
				{state === "open" && !isMergeable && !draft && (
					<p className="mt-2 text-xs text-muted-foreground">
						{mergeableState === "dirty"
							? "This branch has conflicts that must be resolved."
							: mergeableState === "blocked"
								? "Merging is blocked by branch protection rules."
								: mergeableState === null
									? "Merge status unknown."
									: `Merge state: ${mergeableState}`}
					</p>
				)}
				{state === "open" && draft && (
					<p className="mt-2 text-xs text-muted-foreground">
						This pull request is a draft and cannot be merged yet.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sync from GitHub component — shown when PR is not found locally
// ---------------------------------------------------------------------------

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
	const [syncResult, triggerSync] = useAtom(syncClient.syncPullRequest.call);

	const isSyncing = Result.isWaiting(syncResult);
	const hasFailed = Result.isFailure(syncResult);
	const hasSucceeded = Result.isSuccess(syncResult);

	return (
		<div>
			<h1 className="text-2xl font-bold">Pull Request #{number}</h1>
			<p className="mt-2 text-muted-foreground">
				This pull request hasn&apos;t been synced yet.
			</p>
			<div className="mt-4">
				{!hasSucceeded && (
					<Button
						onClick={() => {
							triggerSync({
								ownerLogin: owner,
								name,
								number,
							});
						}}
						disabled={isSyncing}
					>
						{isSyncing ? "Syncing from GitHub..." : "Sync from GitHub"}
					</Button>
				)}
				{hasSucceeded && (
					<p className="text-sm text-muted-foreground">
						Sync complete. Data will appear momentarily...
					</p>
				)}
				{hasFailed && (
					<p className="mt-2 text-sm text-destructive">
						Failed to sync from GitHub. The pull request may not exist, or the
						repository may be private.
					</p>
				)}
			</div>
		</div>
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
	const config = {
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
	}[status];

	return (
		<span
			className={`inline-flex items-center justify-center size-5 rounded text-[10px] font-bold ${config.className}`}
		>
			{config.label}
		</span>
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
			<svg
				className="mt-1.5 size-5 text-muted-foreground shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Zm0-3a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
			</svg>
		);
	}
	if (state === "open") {
		return (
			<svg
				className="mt-1.5 size-5 text-green-600 shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
			</svg>
		);
	}
	return (
		<svg
			className="mt-1.5 size-5 text-purple-600 shrink-0"
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
	if (mergedAt !== null) {
		return <Badge className="bg-purple-600 hover:bg-purple-700">Merged</Badge>;
	}
	if (draft) {
		return <Badge variant="outline">Draft</Badge>;
	}
	if (state === "open") {
		return <Badge className="bg-green-600 hover:bg-green-700">Open</Badge>;
	}
	return <Badge variant="secondary">Closed</Badge>;
}

function MergeableStateBadge({ state }: { state: string }) {
	switch (state) {
		case "clean":
			return (
				<Badge variant="secondary" className="text-green-600 text-xs">
					Ready to merge
				</Badge>
			);
		case "dirty":
			return (
				<Badge variant="destructive" className="text-xs">
					Has conflicts
				</Badge>
			);
		case "blocked":
			return (
				<Badge variant="outline" className="text-xs">
					Blocked
				</Badge>
			);
		case "unstable":
			return (
				<Badge variant="outline" className="text-xs text-yellow-600">
					Unstable
				</Badge>
			);
		default:
			return (
				<Badge variant="outline" className="text-xs">
					{state}
				</Badge>
			);
	}
}

function ReviewStateBadge({ state }: { state: string }) {
	switch (state) {
		case "APPROVED":
			return (
				<Badge variant="secondary" className="text-green-600 text-xs">
					Approved
				</Badge>
			);
		case "CHANGES_REQUESTED":
			return (
				<Badge variant="destructive" className="text-xs">
					Changes requested
				</Badge>
			);
		case "COMMENTED":
			return (
				<Badge variant="outline" className="text-xs">
					Commented
				</Badge>
			);
		case "DISMISSED":
			return (
				<Badge variant="outline" className="text-xs text-muted-foreground">
					Dismissed
				</Badge>
			);
		case "PENDING":
			return (
				<Badge variant="outline" className="text-xs">
					Pending
				</Badge>
			);
		default:
			return (
				<Badge variant="outline" className="text-xs">
					{state}
				</Badge>
			);
	}
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
			<Badge variant="destructive">
				{optimisticErrorMessage ?? "GitHub rejected this review."}
			</Badge>
		);
	}
	if (optimisticState === "pending") {
		return <Badge variant="outline">Syncing with GitHub</Badge>;
	}
	if (optimisticState === "confirmed") {
		return (
			<Badge variant="secondary" className="text-green-600">
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
	if (conclusion === "success") {
		return (
			<svg
				className="size-4 text-green-600"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
			</svg>
		);
	}
	if (conclusion === "failure") {
		return (
			<svg
				className="size-4 text-red-600"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
			</svg>
		);
	}
	if (status === "in_progress") {
		return (
			<svg
				className="size-4 text-yellow-500 animate-spin"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path
					d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"
					opacity=".3"
				/>
				<path d="M8 0a8 8 0 0 1 8 8h-1.5A6.5 6.5 0 0 0 8 1.5V0Z" />
			</svg>
		);
	}
	return (
		<svg
			className="size-4 text-muted-foreground"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
		</svg>
	);
}
