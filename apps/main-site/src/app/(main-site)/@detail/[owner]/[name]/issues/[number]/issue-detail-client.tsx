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
import { Textarea } from "@packages/ui/components/textarea";
import { cn } from "@packages/ui/lib/utils";
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { CheckCircle2, CircleDot } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Streamdown } from "streamdown";

type IssueDetail = {
	readonly repositoryId: number;
	readonly number: number;
	readonly state: "open" | "closed";
	readonly title: string;
	readonly body: string | null;
	readonly authorLogin: string | null;
	readonly authorAvatarUrl: string | null;
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
			<div className="p-4">
				{/* Header */}
				<div className="flex items-start gap-2">
					<IssueStateIconLarge state={issue.state} />
					<div className="min-w-0 flex-1">
						<h1 className="text-lg font-bold break-words leading-tight">
							{issue.title}
						</h1>
						<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
							<span>#{issue.number}</span>
							<IssueStateBadge state={issue.state} closedAt={issue.closedAt} />
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
					</div>
				</div>

				{/* Labels */}
				{issue.labelNames.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{issue.labelNames.map((label) => (
							<Badge key={label} variant="outline" className="text-[10px]">
								{label}
							</Badge>
						))}
					</div>
				)}

				{/* Metadata */}
				<div className="mt-2">
					<span className="text-xs text-muted-foreground">
						Updated {formatRelative(issue.githubUpdatedAt)}
					</span>
				</div>

				{/* Body */}
				{issue.body && (
					<Card className="mt-4">
						<CardContent className="px-3 pt-3">
							<div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto text-sm">
								<Streamdown>{issue.body}</Streamdown>
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
											<Streamdown>{comment.body}</Streamdown>
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

// --- Icons/badges ---

function IssueStateIconLarge({ state }: { state: "open" | "closed" }) {
	if (state === "open")
		return <CircleDot className="mt-1 size-5 text-green-600 shrink-0" />;
	return <CheckCircle2 className="mt-1 size-5 text-purple-600 shrink-0" />;
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
			<Badge className="bg-green-600 hover:bg-green-700 text-[10px]">
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
