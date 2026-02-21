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
import { CheckCircle2, CircleDot, Search } from "@packages/ui/components/icons";
import { Input } from "@packages/ui/components/input";
import { Separator } from "@packages/ui/components/separator";
import { Textarea } from "@packages/ui/components/textarea";
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useId, useMemo, useState } from "react";
import { AssigneesCombobox } from "@/app/(main-site)/_components/assignees-combobox";
import { LabelsCombobox } from "@/app/(main-site)/_components/labels-combobox";
import { MarkdownBody } from "@/components/markdown-body";

type IssueDetail = {
	readonly repositoryId: number;
	readonly number: number;
	readonly state: "open" | "closed";
	readonly optimisticOperationType:
		| "create_issue"
		| "create_comment"
		| "update_issue_state"
		| "merge_pull_request"
		| "update_labels"
		| "update_assignees"
		| null;
	readonly optimisticState: "pending" | "failed" | "confirmed" | null;
	readonly optimisticErrorMessage: string | null;
	readonly title: string;
	readonly body: string | null;
	readonly authorLogin: string | null;
	readonly authorAvatarUrl: string | null;
	readonly assignees: readonly {
		readonly login: string;
		readonly avatarUrl: string | null;
	}[];
	readonly labelNames: readonly string[];
	readonly commentCount: number;
	readonly closedAt: number | null;
	readonly githubUpdatedAt: number;
	readonly comments: readonly {
		readonly githubCommentId: number;
		readonly authorLogin: string | null;
		readonly authorAvatarUrl: string | null;
		readonly body: string;
		readonly createdAt: number;
	}[];
};

export function IssueDetailClient({
	owner,
	name,
	issueNumber,
	initialIssue,
}: {
	owner: string;
	name: string;
	issueNumber: number;
	initialIssue: IssueDetail | null;
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

	const issue = useSubscriptionWithInitial(issueAtom, initialIssue);
	const [commentQuery, setCommentQuery] = useState("");
	const [commentSort, setCommentSort] = useState<"oldest" | "newest">("oldest");
	const normalizedCommentQuery = commentQuery.trim().toLowerCase();

	const visibleComments = useMemo(() => {
		const comments = issue?.comments ?? [];
		const filtered = comments.filter((comment) => {
			if (normalizedCommentQuery.length === 0) return true;
			return (
				comment.body.toLowerCase().includes(normalizedCommentQuery) ||
				(comment.authorLogin?.toLowerCase().includes(normalizedCommentQuery) ??
					false)
			);
		});

		const sorted = [...filtered].sort((a, b) =>
			commentSort === "oldest"
				? a.createdAt - b.createdAt
				: b.createdAt - a.createdAt,
		);

		return sorted;
	}, [issue, normalizedCommentQuery, commentSort]);

	if (issue === null) {
		return (
			<div className="py-8 text-center">
				<h2 className="text-base font-semibold">Issue #{issueNumber}</h2>
				<p className="mt-1 text-xs text-muted-foreground">Not synced yet.</p>
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
				{/* Main content */}
				<div className="min-w-0 flex-1">
					{/* Header */}
					<div className="flex items-start gap-2.5">
						<IssueStateIconLarge state={issue.state} />
						<div className="min-w-0 flex-1">
							<h1 className="text-base font-bold break-words leading-snug tracking-tight">
								{issue.title}
							</h1>
							<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
								<span className="tabular-nums">#{issue.number}</span>
								<IssueStateBadge
									state={issue.state}
									closedAt={issue.closedAt}
								/>
								{issue.authorLogin && (
									<span className="flex items-center gap-1">
										<Avatar className="size-4">
											<AvatarImage src={issue.authorAvatarUrl ?? undefined} />
											<AvatarFallback className="text-[8px]">
												{issue.authorLogin[0]?.toUpperCase()}
											</AvatarFallback>
										</Avatar>
										<span className="font-medium">{issue.authorLogin}</span>
									</span>
								)}
							</div>
						</div>
					</div>

					{/* Metadata */}
					<div className="mt-2">
						<span className="text-[11px] text-muted-foreground">
							Updated {formatRelative(issue.githubUpdatedAt)}
						</span>
					</div>

					{/* Body */}
					{issue.body && (
						<Card className="mt-3">
							<CardContent>
								<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-sm leading-relaxed">
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
						<div className="mt-4">
							<div className="mb-1.5 flex flex-wrap items-center gap-1.5">
								<h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
									Comments{" "}
									<span className="font-normal">({issue.comments.length})</span>
								</h2>
								{normalizedCommentQuery.length > 0 && (
									<Badge variant="outline" className="text-[10px] h-5">
										{visibleComments.length} match
										{visibleComments.length === 1 ? "" : "es"}
									</Badge>
								)}
							</div>
							<div className="mb-2 flex flex-wrap items-center gap-1.5">
								<div className="relative min-w-0 flex-1">
									<Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
									<Input
										value={commentQuery}
										onChange={(event) => setCommentQuery(event.target.value)}
										placeholder="Filter comments by text or author"
										className="h-8 pl-7 text-xs"
									/>
								</div>
								<Button
									variant={commentSort === "oldest" ? "default" : "outline"}
									size="sm"
									className="h-8 text-[11px]"
									onClick={() => setCommentSort("oldest")}
								>
									Oldest
								</Button>
								<Button
									variant={commentSort === "newest" ? "default" : "outline"}
									size="sm"
									className="h-8 text-[11px]"
									onClick={() => setCommentSort("newest")}
								>
									Newest
								</Button>
							</div>
							{visibleComments.length === 0 && (
								<div className="rounded-md border bg-muted/10 px-3 py-4 text-xs text-muted-foreground">
									No comments match this filter.
								</div>
							)}
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
						</div>
					)}

					{/* Comment form */}
					<Separator className="mt-5" />
					<CommentForm
						ownerLogin={owner}
						name={name}
						number={issueNumber}
						repositoryId={issue.repositoryId}
					/>
				</div>

				{/* Sidebar */}
				<div className="w-full shrink-0 space-y-4 pt-1 xl:sticky xl:top-4 xl:self-start">
					<AssigneesCombobox
						ownerLogin={owner}
						name={name}
						repositoryId={issue.repositoryId}
						number={issueNumber}
						currentAssignees={issue.assignees}
						optimisticOperationType={issue.optimisticOperationType}
						optimisticState={issue.optimisticState}
						optimisticErrorMessage={issue.optimisticErrorMessage}
					/>
					<LabelsCombobox
						ownerLogin={owner}
						name={name}
						repositoryId={issue.repositoryId}
						number={issueNumber}
						currentLabels={issue.labelNames}
						optimisticOperationType={issue.optimisticOperationType}
						optimisticState={issue.optimisticState}
						optimisticErrorMessage={issue.optimisticErrorMessage}
					/>
				</div>
			</div>
		</div>
	);
}

// --- Action bar ---

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
	const isUpdatingState = Result.isWaiting(stateResult);

	return (
		<div className="mt-3 flex flex-wrap items-center gap-2">
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
					{isUpdatingState ? "Closing..." : "Close Issue"}
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
					{isUpdatingState ? "Reopening..." : "Reopen Issue"}
				</Button>
			)}
			{Result.isFailure(stateResult) && (
				<span className="text-xs text-destructive">Update failed.</span>
			)}
		</div>
	);
}

// --- Comment form ---

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
		{ mode: "promise" },
	);
	const [body, setBody] = useState("");
	const correlationPrefix = useId();
	const isSubmitting = Result.isWaiting(commentResult);

	const handleSubmit = async () => {
		const trimmedBody = body.trim();
		if (trimmedBody.length === 0) return;
		try {
			await submitComment({
				correlationId: `${correlationPrefix}-comment-${Date.now()}`,
				ownerLogin,
				name,
				repositoryId,
				number,
				body: trimmedBody,
			});
			setBody("");
		} catch {
			// Error is captured in commentResult for display
		}
	};

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
						<p className="text-xs text-github-open">Submitted!</p>
					)}
				</div>
				<Button
					size="sm"
					disabled={body.trim().length === 0 || isSubmitting}
					onClick={handleSubmit}
				>
					{isSubmitting ? "Submitting..." : "Comment"}
				</Button>
			</div>
		</div>
	);
}

// --- Icons/badges ---

function IssueStateIconLarge({ state }: { state: "open" | "closed" }) {
	if (state === "open")
		return <CircleDot className="mt-1 size-5 text-github-open shrink-0" />;
	return <CheckCircle2 className="mt-1 size-5 text-github-merged shrink-0" />;
}

function IssueStateBadge({
	state,
	closedAt,
}: {
	state: "open" | "closed";
	closedAt: number | null;
}) {
	if (state === "open")
		return (
			<Badge className="bg-github-open hover:bg-github-open/90 text-[10px]">
				Open
			</Badge>
		);
	return (
		<Badge variant="secondary" className="text-[10px]">
			Closed{closedAt ? ` ${formatRelative(closedAt)}` : ""}
		</Badge>
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
