"use client";

import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";

import { Link } from "@packages/ui/components/link";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useQueryStates } from "nuqs";
import { use, useMemo } from "react";
import { type StateFilter, stateFilterParsers } from "../search-params";

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

export function IssueListClient({
	owner,
	name,
	initialDataPromise,
}: {
	owner: string;
	name: string;
	initialDataPromise: Promise<readonly IssueItem[]>;
}) {
	const initialData = use(initialDataPromise);
	const [{ state: stateFilter }, setParams] =
		useQueryStates(stateFilterParsers);

	const client = useProjectionQueries();
	const state = stateFilter === "all" ? undefined : stateFilter;
	const issuesAtom = useMemo(
		() =>
			client.listIssues.subscription({
				ownerLogin: owner,
				name,
				state,
			}),
		[client, owner, name, state],
	);

	const issues = useSubscriptionWithInitial(issuesAtom, initialData);

	return (
		<>
			<StateFilterBar
				value={stateFilter}
				onChange={(s) => setParams({ state: s })}
			/>
			<IssueList
				owner={owner}
				name={name}
				issues={issues}
				stateFilter={stateFilter}
			/>
		</>
	);
}

// --- State filter bar ---

function StateFilterBar({
	value,
	onChange,
}: {
	value: StateFilter;
	onChange: (value: StateFilter) => void;
}) {
	return (
		<div className="flex gap-1.5 sm:gap-2">
			<Button
				variant={value === "open" ? "default" : "outline"}
				size="sm"
				className="text-xs sm:text-sm"
				onClick={() => onChange("open")}
			>
				Open
			</Button>
			<Button
				variant={value === "closed" ? "default" : "outline"}
				size="sm"
				className="text-xs sm:text-sm"
				onClick={() => onChange("closed")}
			>
				Closed
			</Button>
			<Button
				variant={value === "all" ? "default" : "outline"}
				size="sm"
				className="text-xs sm:text-sm"
				onClick={() => onChange("all")}
			>
				All
			</Button>
		</div>
	);
}

// --- Issue list (pure render, no loading states) ---

function IssueList({
	owner,
	name,
	issues,
	stateFilter,
}: {
	owner: string;
	name: string;
	issues: readonly IssueItem[];
	stateFilter: StateFilter;
}) {
	if (issues.length === 0) {
		return (
			<p className="mt-6 text-sm text-muted-foreground">
				No {stateFilter !== "all" ? stateFilter : ""} issues found.
			</p>
		);
	}

	return (
		<>
			<div className="mt-4 divide-y">
				{issues.map((issue) => (
					<Link
						key={issue.number}
						href={`/${owner}/${name}/issues/${issue.number}`}
						className="flex items-start gap-2 sm:gap-3 px-3 py-2.5 sm:px-4 sm:py-3 hover:bg-muted/50 transition-colors"
					>
						<div className="mt-0.5 shrink-0">
							<IssueStateIcon state={issue.state} />
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
								<span className="font-medium text-sm sm:text-base break-words">
									{issue.title}
								</span>
								{issue.labelNames.map((label) => (
									<Badge
										key={label}
										variant="outline"
										className="text-xs shrink-0"
									>
										{label}
									</Badge>
								))}
							</div>
							<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-sm text-muted-foreground">
								<span>#{issue.number}</span>
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
								<span>{formatRelative(issue.githubUpdatedAt)}</span>
								{issue.commentCount > 0 && (
									<span>
										{issue.commentCount} comment
										{issue.commentCount !== 1 ? "s" : ""}
									</span>
								)}
							</div>
						</div>
					</Link>
				))}
			</div>
			{issues.length >= 200 && (
				<p className="mt-2 text-center text-sm text-muted-foreground">
					Showing first 200 results
				</p>
			)}
		</>
	);
}

// --- Helpers ---

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

function IssueStateIcon({ state }: { state: "open" | "closed" }) {
	if (state === "open") {
		return (
			<svg
				className="size-4 text-status-open"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
				<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
			</svg>
		);
	}
	return (
		<svg
			className="size-4 text-status-closed"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z" />
			<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z" />
		</svg>
	);
}
