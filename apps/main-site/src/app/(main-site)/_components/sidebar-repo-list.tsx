"use client";

import { Result, useAtomValue } from "@effect-atom/atom-react";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@packages/ui/components/collapsible";
import { useConvexAuthState } from "@packages/ui/components/convex-client-provider";
import { ChevronRight } from "@packages/ui/components/icons";
import { Link } from "@packages/ui/components/link";
import { Skeleton } from "@packages/ui/components/skeleton";
import { authClient } from "@packages/ui/lib/auth-client";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { Array as Arr, Option, pipe, Record as Rec } from "effect";
import { useMemo } from "react";
import type { SidebarRepo } from "./sidebar-client";

const EmptyPayload: Record<string, never> = {};

/**
 * Body content for the homepage / notifications sidebar — grouped repo list.
 * Rendered inside the universal SidebarClient shell.
 */
export function SidebarRepoList({
	initialRepos,
	activeOwner = null,
	activeName = null,
}: {
	initialRepos: ReadonlyArray<SidebarRepo>;
	activeOwner?: string | null;
	activeName?: string | null;
}) {
	const session = authClient.useSession();
	const { isReadyForQueries } = useConvexAuthState();
	const client = useProjectionQueries();
	const reposAtom = useMemo(
		() =>
			client.listRepos.subscription(EmptyPayload, {
				enabled: isReadyForQueries,
			}),
		[client, isReadyForQueries],
	);
	const result = useAtomValue(reposAtom);

	// For signed-in users the subscription briefly returns unauthenticated
	// (global) repos before the auth token propagates. Show a skeleton during
	// that window so users never see a flash of wrong repos.
	const isSignedIn = !!session.data;
	const subscriptionSettled = !Result.isInitial(result);

	const repos = !isSignedIn
		? []
		: subscriptionSettled
			? (() => {
					const valueOption = Result.value(result);
					return Option.isSome(valueOption)
						? (valueOption.value as ReadonlyArray<SidebarRepo>)
						: initialRepos;
				})()
			: initialRepos;

	const grouped = useMemo(
		() =>
			pipe(
				repos,
				Arr.groupBy((repo) => repo.ownerLogin),
			),
		[repos],
	);
	const entries = useMemo(() => Rec.toEntries(grouped), [grouped]);

	// Show skeleton while the authenticated subscription hasn't settled yet.
	if (isSignedIn && !subscriptionSettled) {
		return <RepoListSkeleton />;
	}

	return (
		<>
			{/* Header */}
			<div className="shrink-0 px-2 pt-2 pb-1.5 border-b border-sidebar-border">
				<div className="flex items-center justify-between">
					<h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
						Repos
					</h2>
					<span className="text-[10px] text-muted-foreground/30 tabular-nums">
						{repos.length}
					</span>
				</div>
			</div>

			{/* Repo list */}
			<div className="py-0.5">
				{isSignedIn && repos.length === 0 && (
					<div className="px-2 py-6 text-center">
						<p className="text-[11px] font-medium text-foreground">
							No repos yet
						</p>
						<p className="mt-0.5 text-[9px] text-muted-foreground/40 leading-snug">
							Install the GitHub App to sync.
						</p>
					</div>
				)}

				{repos.length > 0 &&
					entries.map(([owner, ownerRepos]) => {
						const ownerHasActiveRepo = activeOwner === owner;
						const ownerAvatarUrl = ownerRepos[0]?.ownerAvatarUrl ?? null;
						return (
							<Collapsible
								key={owner}
								defaultOpen={ownerHasActiveRepo || entries.length === 1}
							>
								<CollapsibleTrigger
									className={cn(
										"flex w-full items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors [&[data-state=open]>svg]:rotate-90",
										ownerHasActiveRepo
											? "text-foreground/70"
											: "text-muted-foreground/40 hover:text-muted-foreground/70",
									)}
								>
									<ChevronRight className="size-2.5 shrink-0 transition-transform duration-150" />
									<Avatar className="size-3.5">
										{ownerAvatarUrl && (
											<AvatarImage src={ownerAvatarUrl} alt={owner} />
										)}
										<AvatarFallback className="text-[7px]">
											{owner.slice(0, 2).toUpperCase()}
										</AvatarFallback>
									</Avatar>
									<span className="truncate">{owner}</span>
								</CollapsibleTrigger>
								<CollapsibleContent>
									<div className="ml-3 border-l border-sidebar-border/50">
										{ownerRepos.map((repo) => {
											const isActive =
												repo.ownerLogin === activeOwner &&
												repo.name === activeName;
											return (
												<Link
													key={repo.repositoryId}
													href={`/${repo.ownerLogin}/${repo.name}`}
													className={cn(
														"group flex items-center gap-1 pl-2 pr-2 py-0.5 no-underline transition-colors",
														isActive
															? "bg-accent text-foreground border-l-2 border-foreground -ml-px"
															: "text-muted-foreground hover:text-foreground hover:bg-accent/40",
													)}
												>
													<Avatar className="size-3.5 shrink-0">
														{repo.ownerAvatarUrl && (
															<AvatarImage
																src={repo.ownerAvatarUrl}
																alt={repo.name}
															/>
														)}
														<AvatarFallback className="text-[7px]">
															{repo.name.slice(0, 2).toUpperCase()}
														</AvatarFallback>
													</Avatar>
													<span className="truncate text-[11px] leading-none">
														{repo.name}
													</span>
												</Link>
											);
										})}
									</div>
								</CollapsibleContent>
							</Collapsible>
						);
					})}
			</div>
		</>
	);
}

// ---------------------------------------------------------------------------
// Skeleton — matches the shape of the grouped repo list
// ---------------------------------------------------------------------------

export function RepoListSkeleton() {
	return (
		<>
			{/* Header skeleton */}
			<div className="shrink-0 px-2 pt-2 pb-1.5 border-b border-sidebar-border">
				<div className="flex items-center justify-between">
					<Skeleton className="h-3 w-10 rounded-sm" />
					<Skeleton className="h-3 w-4 rounded-sm" />
				</div>
			</div>

			{/* Repo list skeleton — simulate two owner groups */}
			<div className="py-0.5">
				{/* Group 1 */}
				<div className="px-2 py-1 flex items-center gap-1">
					<Skeleton className="size-2.5 rounded-sm" />
					<Skeleton className="size-3.5 rounded-full" />
					<Skeleton className="h-2.5 w-20 rounded-sm" />
				</div>
				<div className="ml-3 border-l border-sidebar-border/50 space-y-px">
					{[1, 2, 3].map((i) => (
						<div key={i} className="flex items-center gap-1 pl-2 pr-2 py-0.5">
							<Skeleton className="size-3.5 shrink-0 rounded-full" />
							<Skeleton
								className="h-2.5 rounded-sm"
								style={{ width: `${60 + i * 12}px` }}
							/>
						</div>
					))}
				</div>

				{/* Group 2 */}
				<div className="px-2 py-1 flex items-center gap-1">
					<Skeleton className="size-2.5 rounded-sm" />
					<Skeleton className="size-3.5 rounded-full" />
					<Skeleton className="h-2.5 w-16 rounded-sm" />
				</div>
				<div className="ml-3 border-l border-sidebar-border/50 space-y-px">
					{[1, 2].map((i) => (
						<div key={i} className="flex items-center gap-1 pl-2 pr-2 py-0.5">
							<Skeleton className="size-3.5 shrink-0 rounded-full" />
							<Skeleton
								className="h-2.5 rounded-sm"
								style={{ width: `${50 + i * 15}px` }}
							/>
						</div>
					))}
				</div>
			</div>
		</>
	);
}
