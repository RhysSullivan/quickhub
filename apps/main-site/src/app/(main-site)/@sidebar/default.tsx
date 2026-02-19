"use client";

import { Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { Button } from "@packages/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@packages/ui/components/collapsible";
import { Input } from "@packages/ui/components/input";
import { Link } from "@packages/ui/components/link";
import { Skeleton } from "@packages/ui/components/skeleton";
import { UserButton } from "@packages/ui/components/user-button";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useRepoOnboard } from "@packages/ui/rpc/repo-onboard";
import { Array as Arr, Option, pipe, Record as Rec } from "effect";
import { ChevronRight, Download, ExternalLink, Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useRef, useState } from "react";

const EmptyPayload: Record<string, never> = {};

const GITHUB_APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "";
const GITHUB_APP_INSTALL_URL = GITHUB_APP_SLUG
	? `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`
	: "";

export default function SidebarSlot() {
	const pathname = usePathname();
	const segments = pathname.split("/").filter(Boolean);
	const activeOwner = segments[0] ?? null;
	const activeName = segments[1] ?? null;

	const client = useProjectionQueries();
	const reposAtom = useMemo(
		() => client.listRepos.subscription(EmptyPayload),
		[client],
	);
	const reposResult = useAtomValue(reposAtom);

	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 p-3 border-b">
				<h2 className="text-sm font-semibold text-foreground">Repositories</h2>
				<AddRepoSection />
			</div>
			<div className="flex-1 overflow-y-auto">
				<div className="p-1">
					{Result.isInitial(reposResult) && (
						<div className="space-y-2 p-2">
							{[1, 2, 3].map((i) => (
								<div key={i} className="space-y-1.5 px-2 py-2">
									<Skeleton className="h-4 w-32" />
									<Skeleton className="h-3 w-20" />
								</div>
							))}
						</div>
					)}

					{(() => {
						const valueOption = Result.value(reposResult);
						if (Option.isNone(valueOption)) return null;
						const repos = valueOption.value;

						if (repos.length === 0) {
							return <EmptyRepoState />;
						}

						const grouped = pipe(
							repos,
							Arr.groupBy((repo) => repo.ownerLogin),
						);
						const entries = Rec.toEntries(grouped);

						return entries.map(([owner, ownerRepos]) => {
							const ownerHasActiveRepo = activeOwner === owner;
							return (
								<Collapsible
									key={owner}
									defaultOpen={ownerHasActiveRepo || entries.length === 1}
								>
									<CollapsibleTrigger className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-90">
										<ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200" />
										<span className="truncate">{owner}</span>
										<span className="ml-auto text-[10px] font-normal tabular-nums text-muted-foreground/60">
											{ownerRepos.length}
										</span>
									</CollapsibleTrigger>
									<CollapsibleContent>
										<div className="ml-2 border-l border-border/50 pl-1">
											{ownerRepos.map((repo) => {
												const isActive =
													repo.ownerLogin === activeOwner &&
													repo.name === activeName;
												return (
													<Link
														key={repo.repositoryId}
														href={`/${repo.ownerLogin}/${repo.name}/pulls`}
														className={cn(
															"flex flex-col gap-1 rounded-md px-2.5 py-1.5 text-sm transition-colors no-underline",
															isActive
																? "bg-accent text-accent-foreground"
																: "text-muted-foreground hover:bg-muted hover:text-foreground",
														)}
													>
														<span className="font-medium text-foreground truncate text-xs">
															{repo.name}
														</span>
														<div className="flex items-center gap-2 text-[11px]">
															<span>{repo.openPrCount} PRs</span>
															<span>{repo.openIssueCount} issues</span>
															{repo.failingCheckCount > 0 && (
																<span className="text-destructive">
																	{repo.failingCheckCount} failing
																</span>
															)}
														</div>
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

			{/* Auth state — pinned to bottom-left */}
			<div className="shrink-0 border-t px-3 py-2">
				<UserButton />
			</div>
		</div>
	);
}

/** Empty state shown when no repos are connected yet. Guides users to install the GitHub App. */
function EmptyRepoState() {
	return (
		<div className="px-3 py-6 text-center">
			<Download className="mx-auto size-8 text-muted-foreground/40" />
			<p className="mt-2 text-xs font-medium text-foreground">
				No repositories yet
			</p>
			<p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
				Install the GitHub App on your account or organization to start syncing
				repositories.
			</p>
			{GITHUB_APP_INSTALL_URL && (
				<Button asChild size="sm" className="mt-3 h-7 text-xs w-full">
					<a
						href={GITHUB_APP_INSTALL_URL}
						target="_blank"
						rel="noopener noreferrer"
					>
						<Download className="size-3" />
						Install GitHub App
					</a>
				</Button>
			)}
		</div>
	);
}

/** Add repo section: primary Install GitHub App button + collapsible manual input. */
function AddRepoSection() {
	return (
		<div className="mt-2 space-y-1.5">
			{/* Primary: Install GitHub App */}
			{GITHUB_APP_INSTALL_URL && (
				<Button asChild size="sm" className="h-7 text-xs w-full">
					<a
						href={GITHUB_APP_INSTALL_URL}
						target="_blank"
						rel="noopener noreferrer"
					>
						<Download className="size-3" />
						Install GitHub App
						<ExternalLink className="size-2.5 ml-auto opacity-50" />
					</a>
				</Button>
			)}

			{/* Secondary: Manual owner/repo input (collapsible) */}
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
			<CollapsibleTrigger className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
				<ChevronRight
					className={cn("size-3 transition-transform", open && "rotate-90")}
				/>
				<Plus className="size-3" />
				<span>Add manually</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<form
					className="flex gap-1.5 mt-1"
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
						className="h-7 text-xs flex-1"
					/>
					<Button
						type="submit"
						size="sm"
						variant="secondary"
						disabled={isLoading}
						className="h-7 text-xs px-2"
					>
						{isLoading ? "..." : "Add"}
					</Button>
				</form>
				{errorMessage && (
					<p className="mt-1 text-[11px] text-destructive">{errorMessage}</p>
				)}
				{isSuccess && (
					<p className="mt-1 text-[11px] text-green-600">Repository added!</p>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
