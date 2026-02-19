"use client";

import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import {
	Card,
	CardDescription,
	CardHeader,
} from "@packages/ui/components/card";
import { Link } from "@packages/ui/components/link";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useQueryStates } from "nuqs";
import { use, useMemo } from "react";
import { type StateFilter, stateFilterParsers } from "../search-params";

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

export function PullRequestListClient({
	owner,
	name,
	initialDataPromise,
}: {
	owner: string;
	name: string;
	initialDataPromise: Promise<readonly PrItem[]>;
}) {
	const initialData = use(initialDataPromise);
	const [{ state: stateFilter }, setParams] =
		useQueryStates(stateFilterParsers);

	const client = useProjectionQueries();
	const prsAtom = useMemo(
		() =>
			client.listPullRequests.subscription({
				ownerLogin: owner,
				name,
				state:
					stateFilter === "all"
						? undefined
						: (stateFilter as "open" | "closed"),
			}),
		[client, owner, name, stateFilter],
	);

	// Use server-fetched data immediately; swap to subscription once connected.
	// initialData is only used for the default "open" filter — if user switches
	// filter, the subscription atom changes and useSubscriptionWithInitial falls
	// back to initialData only while that atom is in Initial state.
	const prs = useSubscriptionWithInitial(prsAtom, initialData);

	return (
		<>
			<StateFilterBar
				value={stateFilter}
				onChange={(s) => setParams({ state: s })}
			/>
			<PrList owner={owner} name={name} prs={prs} stateFilter={stateFilter} />
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

// --- Pull request list (pure render, no loading states) ---

function PrList({
	owner,
	name,
	prs,
	stateFilter,
}: {
	owner: string;
	name: string;
	prs: readonly PrItem[];
	stateFilter: StateFilter;
}) {
	if (prs.length === 0) {
		return (
			<Card className="mt-4">
				<CardHeader>
					<CardDescription>
						No {stateFilter !== "all" ? stateFilter : ""} pull requests found.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<>
			<div className="mt-4 divide-y rounded-lg border">
				{prs.map((pr) => (
					<Link
						key={pr.number}
						href={`/${owner}/${name}/pulls/${pr.number}`}
						className="flex items-start gap-2 sm:gap-3 px-3 py-2.5 sm:px-4 sm:py-3 hover:bg-muted/50 transition-colors"
					>
						<div className="mt-0.5 shrink-0">
							<PrStateIcon state={pr.state} draft={pr.draft} />
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
								<span className="font-medium text-sm sm:text-base break-words">
									{pr.title}
								</span>
								{pr.draft && (
									<Badge variant="outline" className="text-xs shrink-0">
										Draft
									</Badge>
								)}
								{pr.lastCheckConclusion && (
									<span className="shrink-0">
										<CheckBadge conclusion={pr.lastCheckConclusion} />
									</span>
								)}
							</div>
							<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-sm text-muted-foreground">
								<span>#{pr.number}</span>
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
								<span className="hidden sm:inline">
									{pr.headRefName} &rarr; {pr.baseRefName}
								</span>
								<span>{formatRelative(pr.githubUpdatedAt)}</span>
								{pr.commentCount > 0 && (
									<span>
										{pr.commentCount} comment{pr.commentCount !== 1 ? "s" : ""}
									</span>
								)}
								{pr.reviewCount > 0 && (
									<span>
										{pr.reviewCount} review{pr.reviewCount !== 1 ? "s" : ""}
									</span>
								)}
							</div>
						</div>
					</Link>
				))}
			</div>
			{prs.length >= 200 && (
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

function PrStateIcon({
	state,
	draft,
}: {
	state: "open" | "closed";
	draft: boolean;
}) {
	if (draft)
		return (
			<svg
				className="size-4 text-muted-foreground"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Zm0-3a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
			</svg>
		);
	if (state === "open")
		return (
			<svg
				className="size-4 text-green-600"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
			</svg>
		);
	return (
		<svg
			className="size-4 text-purple-600"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8-9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
		</svg>
	);
}

function CheckBadge({ conclusion }: { conclusion: string }) {
	if (conclusion === "success")
		return (
			<Badge variant="secondary" className="text-xs text-green-600">
				Passing
			</Badge>
		);
	if (conclusion === "failure")
		return (
			<Badge variant="destructive" className="text-xs">
				Failing
			</Badge>
		);
	return (
		<Badge variant="outline" className="text-xs">
			{conclusion}
		</Badge>
	);
}
