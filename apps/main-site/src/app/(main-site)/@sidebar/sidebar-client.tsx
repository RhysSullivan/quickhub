"use client";

import { Result, useAtom } from "@effect-atom/atom-react";
import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import { Button } from "@packages/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@packages/ui/components/collapsible";
import { ChevronRight, Download, Plus } from "@packages/ui/components/icons";
import { Input } from "@packages/ui/components/input";
import { Link } from "@packages/ui/components/link";
import { Skeleton } from "@packages/ui/components/skeleton";
import { UserButton } from "@packages/ui/components/user-button";
import { GitHubIcon } from "@packages/ui/icons/index";
import { authClient } from "@packages/ui/lib/auth-client";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useRepoOnboard } from "@packages/ui/rpc/repo-onboard";
import { Array as Arr, Option, pipe, Record as Rec } from "effect";
import { usePathname } from "next/navigation";
import { useMemo, useRef, useState } from "react";

const EmptyPayload: Record<string, never> = {};

const GITHUB_APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "";
const GITHUB_APP_INSTALL_URL = GITHUB_APP_SLUG
	? `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`
	: "";

export type SidebarRepo = {
	repositoryId: number;
	fullName: string;
	ownerLogin: string;
	ownerAvatarUrl: string | null;
	name: string;
	openPrCount: number;
	openIssueCount: number;
	failingCheckCount: number;
	lastPushAt: number | null;
	updatedAt: number;
};

export function SidebarClient({
	initialRepos,
}: {
	initialRepos: ReadonlyArray<SidebarRepo>;
}) {
	const session = authClient.useSession();

	if (session.isPending) {
		return <SidebarSkeleton />;
	}

	if (!session.data) {
		return <SignedOutSidebar initialRepos={initialRepos} />;
	}

	return <SignedInSidebar initialRepos={initialRepos} />;
}

// ---------------------------------------------------------------------------
// Signed-in sidebar — personalized repo list with add/manage
// ---------------------------------------------------------------------------

function SignedInSidebar({
	initialRepos,
}: {
	initialRepos: ReadonlyArray<SidebarRepo>;
}) {
	const pathname = usePathname();
	const segments = pathname.split("/").filter(Boolean);
	const activeOwner = segments[0] ?? null;
	const activeName = segments[1] ?? null;

	const client = useProjectionQueries();
	const reposAtom = useMemo(
		() => client.listRepos.subscription(EmptyPayload),
		[client],
	);
	const repos = useSubscriptionWithInitial(reposAtom, initialRepos);

	return (
		<div className="flex h-full flex-col bg-sidebar">
			{/* Header */}
			<div className="shrink-0 px-2 pt-2 pb-1.5 border-b border-sidebar-border">
				<div className="flex items-center justify-between mb-1.5">
					<h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
						Repos
					</h2>
					<span className="text-[10px] text-muted-foreground/30 tabular-nums">
						{repos.length}
					</span>
				</div>
				<AddRepoSection />
			</div>

			{/* Repo list */}
			<div className="flex-1 overflow-y-auto">
				<div className="py-0.5">
					{repos.length === 0 && <EmptyRepoState />}

					{repos.length > 0 &&
						(() => {
							const grouped = pipe(
								repos,
								Arr.groupBy((repo) => repo.ownerLogin),
							);
							const entries = Rec.toEntries(grouped);

							return entries.map(([owner, ownerRepos]) => {
								const ownerHasActiveRepo = activeOwner === owner;
								const ownerAvatarUrl = ownerRepos[0]?.ownerAvatarUrl ?? null;
								return (
									<Collapsible
										key={owner}
										defaultOpen={ownerHasActiveRepo || entries.length === 1}
									>
										<CollapsibleTrigger className="flex w-full items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors [&[data-state=open]>svg]:rotate-90">
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
															href={`/${repo.ownerLogin}/${repo.name}/pulls`}
															className={cn(
																"group flex items-center gap-1 pl-2 pr-2 py-0.5 no-underline transition-colors",
																isActive
																	? "bg-accent text-foreground border-l-2 border-foreground -ml-px"
																	: "text-muted-foreground hover:text-foreground hover:bg-accent/40",
															)}
														>
															<span className="truncate text-[11px] leading-none">
																{repo.name}
															</span>
															{(repo.openPrCount > 0 ||
																repo.failingCheckCount > 0) && (
																<span className="ml-auto shrink-0 text-[9px] text-muted-foreground/30 tabular-nums">
																	{repo.openPrCount > 0 && (
																		<span>{repo.openPrCount}</span>
																	)}
																	{repo.failingCheckCount > 0 && (
																		<span className="text-red-500/60 ml-1">
																			{repo.failingCheckCount}
																		</span>
																	)}
																</span>
															)}
														</Link>
													);
												})}
											</div>
										</CollapsibleContent>
									</Collapsible>
								);
							});
						})()}
				</div>
			</div>

			{/* User — pinned to bottom */}
			<div className="shrink-0 border-t border-sidebar-border px-2 py-1.5 flex items-center">
				<UserButton />
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Signed-out sidebar — overview + sign-in CTA
// ---------------------------------------------------------------------------

function SignedOutSidebar({
	initialRepos,
}: {
	initialRepos: ReadonlyArray<SidebarRepo>;
}) {
	const client = useProjectionQueries();
	const reposAtom = useMemo(
		() => client.listRepos.subscription(EmptyPayload),
		[client],
	);
	const repos = useSubscriptionWithInitial(reposAtom, initialRepos);

	return (
		<div className="flex h-full flex-col bg-sidebar">
			{/* Brand header */}
			<div className="shrink-0 px-2 pt-2 pb-1.5 border-b border-sidebar-border">
				<h2 className="text-xs font-bold tracking-tight text-foreground">
					QuickHub
				</h2>
				<p className="mt-0.5 text-[9px] text-muted-foreground/50 leading-snug">
					GitHub dashboard for repos, PRs &amp; CI.
				</p>
			</div>

			{/* Repo overview (read-only) */}
			<div className="flex-1 overflow-y-auto">
				<div className="py-0.5">
					{repos.length > 0 && (
						<>
							<p className="px-2 py-1 text-[9px] font-semibold text-muted-foreground/30 uppercase tracking-wider">
								Active
							</p>
							{repos.map((repo) => (
								<div
									key={repo.repositoryId}
									className="flex items-center gap-1 px-2 py-0.5 min-w-0"
								>
									<Avatar className="size-3.5 shrink-0">
										{repo.ownerAvatarUrl && (
											<AvatarImage
												src={repo.ownerAvatarUrl}
												alt={repo.ownerLogin}
											/>
										)}
										<AvatarFallback className="text-[7px]">
											{repo.ownerLogin.slice(0, 2).toUpperCase()}
										</AvatarFallback>
									</Avatar>
									<span className="text-foreground truncate text-[11px] leading-none">
										{repo.fullName}
									</span>
									{(repo.openPrCount > 0 || repo.failingCheckCount > 0) && (
										<span className="ml-auto shrink-0 text-[9px] text-muted-foreground/30 tabular-nums">
											{repo.openPrCount > 0 && <span>{repo.openPrCount}</span>}
											{repo.failingCheckCount > 0 && (
												<span className="text-red-500/60 ml-1">
													{repo.failingCheckCount}
												</span>
											)}
										</span>
									)}
								</div>
							))}
						</>
					)}

					{repos.length === 0 && (
						<div className="px-2 py-6 text-center">
							<p className="text-[10px] text-muted-foreground/40">
								Sign in to connect repos.
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Sign-in CTA — pinned to bottom */}
			<div className="shrink-0 border-t border-sidebar-border px-2 py-2">
				<Button
					size="sm"
					className="w-full h-7 text-[11px] gap-1"
					onClick={() => {
						authClient.signIn.social({ provider: "github" });
					}}
				>
					<GitHubIcon className="size-3" />
					Sign in
				</Button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

export function SidebarSkeleton() {
	return (
		<div className="flex h-full flex-col bg-sidebar">
			<div className="shrink-0 px-2 pt-2 pb-1.5 border-b border-sidebar-border">
				<Skeleton className="h-2.5 w-10 mb-1.5" />
				<Skeleton className="h-6 w-full rounded-sm" />
			</div>
			<div className="flex-1 overflow-y-auto">
				<div className="space-y-px py-1 px-2">
					{[1, 2, 3, 4, 5, 6, 7].map((i) => (
						<Skeleton key={i} className="h-5 w-full rounded-sm" />
					))}
				</div>
			</div>
			<div className="shrink-0 border-t border-sidebar-border px-2 py-1.5">
				<Skeleton className="h-5 w-14 rounded-sm" />
			</div>
		</div>
	);
}

function EmptyRepoState() {
	return (
		<div className="px-2 py-6 text-center">
			<p className="text-[11px] font-medium text-foreground">No repos yet</p>
			<p className="mt-0.5 text-[9px] text-muted-foreground/40 leading-snug">
				Install the GitHub App to sync.
			</p>
			{GITHUB_APP_INSTALL_URL && (
				<Button asChild size="sm" className="mt-2 h-6 text-[10px] w-full">
					<a href={GITHUB_APP_INSTALL_URL}>
						<Download className="size-2.5" />
						Install
					</a>
				</Button>
			)}
		</div>
	);
}

function AddRepoSection() {
	return (
		<div className="space-y-1">
			{GITHUB_APP_INSTALL_URL && (
				<Button
					asChild
					size="sm"
					variant="outline"
					className="h-6 text-[10px] w-full"
				>
					<a href={GITHUB_APP_INSTALL_URL}>
						<Download className="size-2.5" />
						Install GitHub App
					</a>
				</Button>
			)}
			<ManualAddCollapsible />
		</div>
	);
}

/** Collapsible manual add-by-URL input for advanced users. */
function ManualAddCollapsible() {
	const [open, setOpen] = useState(false);
	const onboardClient = useRepoOnboard();
	const [addResult, addRepo] = useAtom(onboardClient.addRepoByUrl.call);
	const inputRef = useRef<HTMLInputElement>(null);
	const isLoading = Result.isWaiting(addResult);

	const errorMessage = (() => {
		const err = Result.error(addResult);
		if (Option.isNone(err)) return null;
		const e = err.value;
		if (typeof e === "object" && e !== null && "_tag" in e) {
			const tag = (e as { _tag: string })._tag;
			switch (tag) {
				case "InvalidRepoUrl":
					return "Invalid URL. Use owner/repo format.";
				case "RepoNotFound":
					return "Repository not found on GitHub.";
				case "AlreadyConnected":
					return "Repository is already connected.";
				case "WebhookSetupFailed":
					return "Added, but webhook setup failed.";
				case "NotAuthenticated":
					return "Please sign in to add a repository.";
				case "RpcDefectError": {
					const defect = (e as { defect: unknown }).defect;
					if (typeof defect === "string" && defect.length > 0) return defect;
					if (
						typeof defect === "object" &&
						defect !== null &&
						"name" in defect
					) {
						const name = String((defect as { name: unknown }).name);
						const message =
							"message" in defect
								? String((defect as { message: unknown }).message)
								: "";
						return message.length > 0
							? `${name}: ${message}`
							: `Server error: ${name}`;
					}
					if (
						typeof defect === "object" &&
						defect !== null &&
						"message" in defect
					) {
						const msg = String((defect as { message: unknown }).message);
						if (msg.length > 0) return msg;
					}
					return "An unexpected error occurred.";
				}
			}
		}
		if (e instanceof Error && e.message.length > 0) return e.message;
		return "Failed to add repository.";
	})();

	const isSuccess =
		Result.isSuccess(addResult) && Option.isSome(Result.value(addResult));

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="flex w-full items-center gap-0.5 py-0.5 text-[9px] text-muted-foreground/40 hover:text-muted-foreground transition-colors">
				<ChevronRight
					className={cn("size-2 transition-transform", open && "rotate-90")}
				/>
				<Plus className="size-2" />
				<span>Add manually</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<form
					className="flex gap-1 mt-0.5"
					onSubmit={(e) => {
						e.preventDefault();
						const url = inputRef.current?.value.trim();
						if (!url || isLoading) return;
						addRepo({ url });
					}}
				>
					<Input
						ref={inputRef}
						placeholder="owner/repo"
						disabled={isLoading}
						className="h-6 text-[10px] flex-1"
					/>
					<Button
						type="submit"
						size="sm"
						variant="secondary"
						disabled={isLoading}
						className="h-6 text-[10px] px-1.5"
					>
						{isLoading ? "..." : "Add"}
					</Button>
				</form>
				{errorMessage && (
					<p className="mt-0.5 text-[9px] text-destructive leading-snug">
						{errorMessage}
					</p>
				)}
				{isSuccess && (
					<p className="mt-0.5 text-[9px] text-emerald-600">Added.</p>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
