"use client";

import { Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import { Link } from "@packages/ui/components/link";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useRepoOnboard } from "@packages/ui/rpc/repo-onboard";
import { usePathname } from "next/navigation";
import { use, useMemo } from "react";

type RepoOverview = {
	readonly repositoryId: number;
	readonly fullName: string;
	readonly ownerLogin: string;
	readonly name: string;
	readonly openPrCount: number;
	readonly openIssueCount: number;
	readonly failingCheckCount: number;
	readonly lastPushAt: number | null;
	readonly updatedAt: number;
} | null;

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

// --- Tab navigation (visually tabs, but real route links) ---

const TABS = [
	{ label: "Pull Requests", segment: "pulls" },
	{ label: "Issues", segment: "issues" },
	{ label: "Activity", segment: "activity" },
] as const;

function RepoTabNav({ owner, name }: { owner: string; name: string }) {
	const pathname = usePathname();
	const basePath = `/${owner}/${name}`;

	return (
		<nav className="mt-4 sm:mt-6 flex border-b">
			{TABS.map((tab) => {
				const href = `${basePath}/${tab.segment}`;
				// Active if pathname is exactly the tab route or starts with it (for nested routes within that tab)
				const isActive = pathname === href || pathname.startsWith(`${href}/`);

				return (
					<Link
						key={tab.segment}
						href={href}
						className={cn(
							"px-3 py-2 text-xs sm:text-sm font-medium border-b-2 -mb-px transition-colors",
							isActive
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50",
						)}
					>
						{tab.label}
					</Link>
				);
			})}
		</nav>
	);
}

// --- Repo header with live subscription ---

function RepoHeader({
	owner,
	name,
	initialOverview,
}: {
	owner: string;
	name: string;
	initialOverview: RepoOverview;
}) {
	const client = useProjectionQueries();
	const overviewAtom = useMemo(
		() => client.getRepoOverview.subscription({ ownerLogin: owner, name }),
		[client, owner, name],
	);

	const overview = useSubscriptionWithInitial(overviewAtom, initialOverview);

	if (overview === null) {
		return <SyncRepoFromGitHub owner={owner} name={name} />;
	}

	return (
		<div>
			<h1 className="text-xl sm:text-2xl font-bold break-words">
				<span className="text-muted-foreground">{owner}/</span>
				{name}
			</h1>
			<div className="mt-2 sm:mt-3 flex flex-wrap gap-2 sm:gap-3">
				<Badge variant="secondary">
					{overview.openPrCount} open PR{overview.openPrCount !== 1 ? "s" : ""}
				</Badge>
				<Badge variant="secondary">
					{overview.openIssueCount} open issue
					{overview.openIssueCount !== 1 ? "s" : ""}
				</Badge>
				{overview.failingCheckCount > 0 && (
					<Badge variant="destructive">
						{overview.failingCheckCount} failing
					</Badge>
				)}
				{overview.lastPushAt && (
					<span className="text-xs sm:text-sm text-muted-foreground">
						Last push {formatRelative(overview.lastPushAt)}
					</span>
				)}
			</div>
		</div>
	);
}

// --- Sync repo from GitHub ---

function SyncRepoFromGitHub({ owner, name }: { owner: string; name: string }) {
	const onboardClient = useRepoOnboard();
	const [onboardResult, triggerOnboard] = useAtom(
		onboardClient.addRepoByUrl.call,
	);

	const isSyncing = Result.isWaiting(onboardResult);
	const hasFailed = Result.isFailure(onboardResult);
	const hasSucceeded = Result.isSuccess(onboardResult);

	return (
		<div>
			<h1 className="text-2xl font-bold">
				{owner}/{name}
			</h1>
			<p className="mt-2 text-muted-foreground">
				This repository hasn&apos;t been synced yet.
			</p>
			<div className="mt-4">
				{!hasSucceeded && (
					<Button
						onClick={() => {
							triggerOnboard({
								url: `${owner}/${name}`,
							});
						}}
						disabled={isSyncing}
					>
						{isSyncing ? "Syncing from GitHub..." : "Sync from GitHub"}
					</Button>
				)}
				{hasSucceeded && (
					<p className="text-sm text-muted-foreground">
						Sync started! Data will appear as it loads...
					</p>
				)}
				{hasFailed && (
					<p className="mt-2 text-sm text-destructive">
						Failed to sync from GitHub. The repository may not exist or may be
						private.
					</p>
				)}
			</div>
		</div>
	);
}

// --- Layout shell ---

export function RepoLayoutClient({
	owner,
	name,
	initialOverviewPromise,
	children,
}: {
	owner: string;
	name: string;
	initialOverviewPromise: Promise<RepoOverview>;
	children: React.ReactNode;
}) {
	const initialOverview = use(initialOverviewPromise);

	return (
		<main className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-8">
			<div className="mb-4 sm:mb-6">
				<Link
					href="/"
					className="text-sm text-muted-foreground hover:text-foreground"
				>
					&larr; All repositories
				</Link>
			</div>
			<RepoHeader owner={owner} name={name} initialOverview={initialOverview} />
			<RepoTabNav owner={owner} name={name} />
			<div className="mt-4">{children}</div>
		</main>
	);
}
