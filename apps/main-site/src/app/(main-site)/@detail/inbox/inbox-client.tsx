"use client";

import { Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import {
	Bell,
	CircleDot,
	GitCommit,
	GitPullRequest,
	MessageSquare,
	Package,
	RefreshCw,
	ShieldAlert,
} from "@packages/ui/components/icons";
import { Link } from "@packages/ui/components/link";
import { Skeleton } from "@packages/ui/components/skeleton";
import { authClient } from "@packages/ui/lib/auth-client";
import { cn } from "@packages/ui/lib/utils";
import { useNotifications } from "@packages/ui/rpc/notifications";
import { Option as Opt } from "effect";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EmptyPayload: Record<string, never> = {};

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

type SubjectType =
	| "Issue"
	| "PullRequest"
	| "Release"
	| "Commit"
	| "Discussion"
	| "CheckSuite"
	| "RepositoryVulnerabilityAlert"
	| "RepositoryDependabotAlertsThread";

function SubjectIcon({ type }: { type: SubjectType }) {
	switch (type) {
		case "PullRequest":
			return <GitPullRequest className="size-3.5 text-green-500 shrink-0" />;
		case "Issue":
			return <CircleDot className="size-3.5 text-blue-500 shrink-0" />;
		case "Commit":
			return <GitCommit className="size-3.5 text-muted-foreground shrink-0" />;
		case "Release":
			return <Package className="size-3.5 text-orange-500 shrink-0" />;
		case "Discussion":
			return <MessageSquare className="size-3.5 text-purple-500 shrink-0" />;
		case "RepositoryVulnerabilityAlert":
		case "RepositoryDependabotAlertsThread":
			return <ShieldAlert className="size-3.5 text-red-500 shrink-0" />;
		case "CheckSuite":
			return (
				<div className="size-3.5 rounded-full border-2 border-yellow-500 shrink-0" />
			);
		default:
			return <Bell className="size-3.5 text-muted-foreground shrink-0" />;
	}
}

function reasonLabel(reason: string): string {
	switch (reason) {
		case "assign":
			return "assigned";
		case "author":
			return "author";
		case "ci_activity":
			return "CI";
		case "comment":
			return "comment";
		case "manual":
			return "manual";
		case "mention":
			return "mention";
		case "push":
			return "push";
		case "review_requested":
			return "review";
		case "security_alert":
			return "security";
		case "state_change":
			return "state";
		case "subscribed":
			return "subscribed";
		case "team_mention":
			return "team";
		case "approval_requested":
			return "approval";
		default:
			return reason;
	}
}

export type NotificationItem = {
	readonly githubNotificationId: string;
	readonly repositoryFullName: string;
	readonly repositoryId: number | null;
	readonly subjectTitle: string;
	readonly subjectType: SubjectType;
	readonly subjectUrl: string | null;
	readonly reason: string;
	readonly unread: boolean;
	readonly updatedAt: number;
	readonly lastReadAt: number | null;
	readonly entityNumber: number | null;
};

function getNotificationHref(n: NotificationItem): string | null {
	if (!n.entityNumber) return null;
	const [owner, name] = n.repositoryFullName.split("/");
	if (!owner || !name) return null;
	if (n.subjectType === "PullRequest") {
		return `/${owner}/${name}/pulls/${n.entityNumber}`;
	}
	if (n.subjectType === "Issue") {
		return `/${owner}/${name}/issues/${n.entityNumber}`;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function InboxClient({
	initialNotifications,
}: {
	initialNotifications: ReadonlyArray<NotificationItem>;
}) {
	const client = useNotifications();
	const notificationsAtom = useMemo(
		() => client.listNotifications.subscription(EmptyPayload),
		[client],
	);
	const result = useAtomValue(notificationsAtom);
	const notifications = useSubscriptionWithInitial(
		notificationsAtom,
		initialNotifications,
	);
	const [, markRead] = useAtom(client.markNotificationRead.mutate);
	const [syncResult, syncNotifications] = useAtom(
		client.syncNotifications.call,
	);
	const router = useRouter();
	const autoSyncAtom = useMemo(
		() => client.syncNotifications.callAsQuery(EmptyPayload),
		[client],
	);
	const autoSyncResult = useAtomValue(autoSyncAtom);

	const isSyncing =
		Result.isWaiting(syncResult) || Result.isWaiting(autoSyncResult);

	// Surface errors from both manual sync and auto-sync
	const manualSyncError = Result.error(syncResult);
	const autoSyncError = Result.error(autoSyncResult);
	const syncErrorOption = Opt.isSome(manualSyncError)
		? manualSyncError
		: autoSyncError;

	const syncErrorMessage = useMemo(() => {
		if (Opt.isNone(syncErrorOption)) return null;
		const error = syncErrorOption.value;
		if (
			typeof error === "object" &&
			error !== null &&
			"reason" in error &&
			typeof error.reason === "string"
		) {
			return error.reason;
		}
		if (
			typeof error === "object" &&
			error !== null &&
			"message" in error &&
			typeof error.message === "string"
		) {
			return error.message;
		}
		if (typeof error === "string") {
			return error;
		}
		return `Sync failed: ${JSON.stringify(error)}`;
	}, [syncErrorOption]);

	const hasSyncError = syncErrorMessage !== null;
	const isNotConnectedError =
		syncErrorMessage !== null && syncErrorMessage.includes("not connected");

	if (Result.isInitial(result)) {
		return <InboxSkeleton />;
	}

	const unread = notifications.filter((n) => n.unread);
	const read = notifications.filter((n) => !n.unread);
	const byReason = [...notifications]
		.reduce((acc, notification) => {
			const label = reasonLabel(notification.reason);
			acc.set(label, (acc.get(label) ?? 0) + 1);
			return acc;
		}, new Map<string, number>())
		.entries();
	const reasonStats = [...byReason].sort((a, b) => b[1] - a[1]).slice(0, 6);

	const byRepo = [...notifications]
		.reduce((acc, notification) => {
			acc.set(
				notification.repositoryFullName,
				(acc.get(notification.repositoryFullName) ?? 0) + 1,
			);
			return acc;
		}, new Map<string, number>())
		.entries();
	const repoStats = [...byRepo].sort((a, b) => b[1] - a[1]).slice(0, 8);

	return (
		<div className="h-full overflow-y-auto">
			<div className="px-4 py-4 md:px-6 md:py-5">
				{/* Header */}
				<div className="mb-4 flex items-center justify-between">
					<div>
						<div className="flex items-center gap-2">
							<Bell className="size-4 text-muted-foreground" />
							<h1 className="text-lg font-bold tracking-tight text-foreground">
								Inbox
							</h1>
							{unread.length > 0 && (
								<Badge
									variant="secondary"
									className="text-[10px] px-1.5 py-0 h-4"
								>
									{unread.length}
								</Badge>
							)}
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							Your cross-repo notification queue with fast triage.
						</p>
					</div>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 text-xs gap-1.5"
						disabled={isSyncing}
						onClick={() => syncNotifications(EmptyPayload)}
					>
						<RefreshCw className={cn("size-3", isSyncing && "animate-spin")} />
						{isSyncing ? "Syncing..." : "Sync"}
					</Button>
				</div>

				<div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
					<InboxStat label="Unread" value={unread.length} />
					<InboxStat label="Total" value={notifications.length} />
					<InboxStat label="Repositories" value={repoStats.length} />
					<InboxStat label="Reasons" value={reasonStats.length} />
				</div>

				{hasSyncError && (
					<div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
						<p className="text-xs text-destructive">{syncErrorMessage}</p>
						<div className="mt-2 flex gap-2">
							{isNotConnectedError ? (
								<Button
									size="sm"
									variant="outline"
									className="h-6 text-[11px]"
									onClick={() => {
										authClient.signIn.oauth2({
											providerId: "github-notifications",
											callbackURL: "/inbox",
										});
									}}
								>
									Connect Notifications
								</Button>
							) : (
								<Button
									size="sm"
									variant="outline"
									className="h-6 text-[11px]"
									onClick={() => {
										authClient.signIn.oauth2({
											providerId: "github-notifications",
											callbackURL: "/inbox",
										});
									}}
								>
									Reconnect GitHub
								</Button>
							)}
							<Button
								size="sm"
								variant="ghost"
								className="h-6 text-[11px]"
								disabled={isSyncing}
								onClick={() => syncNotifications(EmptyPayload)}
							>
								Retry Sync
							</Button>
						</div>
					</div>
				)}

				<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
					<div>
						{/* Empty state */}
						{notifications.length === 0 && (
							<div className="py-16 text-center">
								<div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/40">
									<Bell className="size-5 text-muted-foreground/30" />
								</div>
								<p className="mt-3 text-xs font-medium text-muted-foreground">
									No notifications
								</p>
								<p className="mt-1 text-[11px] text-muted-foreground/70">
									Hit sync to fetch your latest GitHub notifications
								</p>
							</div>
						)}

						{/* Unread section */}
						{unread.length > 0 && (
							<section className="mb-6">
								<div className="mb-2 flex items-center gap-1.5">
									<div className="size-1.5 rounded-full bg-blue-500" />
									<h2 className="text-xs font-semibold text-foreground">
										Unread
									</h2>
									<span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
										{unread.length}
									</span>
								</div>
								<div className="divide-y rounded-lg border">
									{unread.map((n) => (
										<NotificationRow
											key={n.githubNotificationId}
											notification={n}
											onNavigate={(href) => {
												markRead({
													githubNotificationId: n.githubNotificationId,
												});
												router.push(href);
											}}
											onMarkRead={() =>
												markRead({
													githubNotificationId: n.githubNotificationId,
												})
											}
										/>
									))}
								</div>
							</section>
						)}

						{/* Read section */}
						{read.length > 0 && (
							<section>
								<div className="mb-2 flex items-center gap-1.5">
									<h2 className="text-xs font-semibold text-muted-foreground">
										Read
									</h2>
									<span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
										{read.length}
									</span>
								</div>
								<div className="divide-y rounded-lg border">
									{read.map((n) => (
										<NotificationRow
											key={n.githubNotificationId}
											notification={n}
											onNavigate={(href) => router.push(href)}
										/>
									))}
								</div>
							</section>
						)}
					</div>

					<div className="space-y-4">
						<InsightCard title="Top Reasons">
							{reasonStats.length === 0 && (
								<p className="text-[11px] text-muted-foreground">
									No data yet.
								</p>
							)}
							{reasonStats.map(([reason, count]) => (
								<div
									key={reason}
									className="flex items-center justify-between text-xs"
								>
									<span className="text-muted-foreground">{reason}</span>
									<span className="tabular-nums font-medium">{count}</span>
								</div>
							))}
						</InsightCard>
						<InsightCard title="Top Repositories">
							{repoStats.length === 0 && (
								<p className="text-[11px] text-muted-foreground">
									No data yet.
								</p>
							)}
							{repoStats.map(([repo, count]) => (
								<div
									key={repo}
									className="flex items-center justify-between gap-2 text-xs"
								>
									<span className="truncate text-muted-foreground">{repo}</span>
									<span className="tabular-nums font-medium">{count}</span>
								</div>
							))}
						</InsightCard>
						<InsightCard title="Quick Paths">
							<div className="space-y-1.5 text-xs">
								<Link
									href="/"
									className="block no-underline text-muted-foreground hover:text-foreground"
								>
									Go to Workbench
								</Link>
								<Link
									href="/inbox"
									className="block no-underline text-muted-foreground hover:text-foreground"
								>
									Stay in Inbox
								</Link>
							</div>
						</InsightCard>
					</div>
				</div>
			</div>
		</div>
	);
}

function InboxStat({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-md border px-3 py-2">
			<p className="text-[10px] uppercase tracking-wide text-muted-foreground">
				{label}
			</p>
			<p className="text-base font-semibold tabular-nums">{value}</p>
		</div>
	);
}

function InsightCard({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="rounded-lg border bg-background">
			<div className="border-b px-3 py-2">
				<h3 className="text-xs font-semibold text-foreground">{title}</h3>
			</div>
			<div className="space-y-2 px-3 py-3">{children}</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Notification row
// ---------------------------------------------------------------------------

function NotificationRow({
	notification,
	onNavigate,
	onMarkRead,
}: {
	notification: NotificationItem;
	onNavigate: (href: string) => void;
	onMarkRead?: () => void;
}) {
	const href = getNotificationHref(notification);

	const content = (
		<div className="flex items-start gap-2.5 px-3 py-2 transition-colors hover:bg-muted">
			<div className="mt-0.5">
				<SubjectIcon type={notification.subjectType} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span
						className={cn(
							"text-xs truncate",
							notification.unread
								? "font-semibold text-foreground"
								: "font-medium text-foreground/80",
						)}
					>
						{notification.subjectTitle}
					</span>
					{notification.unread && (
						<div className="size-1.5 rounded-full bg-blue-500 shrink-0" />
					)}
				</div>
				<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
					<span className="font-medium text-muted-foreground/80 truncate">
						{notification.repositoryFullName}
					</span>
					{notification.entityNumber !== null && (
						<>
							<span className="text-muted-foreground/40">&middot;</span>
							<span>#{notification.entityNumber}</span>
						</>
					)}
					<span className="text-muted-foreground/40">&middot;</span>
					<Badge
						variant="outline"
						className="text-[9px] px-1 py-0 h-3.5 shrink-0"
					>
						{reasonLabel(notification.reason)}
					</Badge>
					<span className="text-muted-foreground/40">&middot;</span>
					<span>{formatRelative(notification.updatedAt)}</span>
				</div>
			</div>
		</div>
	);

	if (href) {
		return (
			<Link
				href={href}
				className="block no-underline"
				onClick={() => onNavigate(href)}
			>
				{content}
			</Link>
		);
	}

	return (
		<Button
			variant="ghost"
			className="w-full h-auto p-0 rounded-none justify-start font-normal"
			onClick={() => onMarkRead?.()}
		>
			{content}
		</Button>
	);
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function InboxSkeleton() {
	return (
		<div className="h-full overflow-y-auto">
			<div className="px-4 py-4 md:px-6 md:py-5">
				<div className="flex items-center justify-between mb-6">
					<div className="flex items-center gap-2">
						<Skeleton className="size-4" />
						<Skeleton className="h-5 w-16" />
					</div>
					<Skeleton className="h-7 w-16" />
				</div>
				<div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
					{[1, 2, 3, 4].map((i) => (
						<Skeleton key={i} className="h-14" />
					))}
				</div>
				<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
					<div className="divide-y rounded-lg border">
						{[1, 2, 3, 4, 5].map((i) => (
							<div key={i} className="flex items-start gap-2.5 px-3 py-2">
								<Skeleton className="size-3.5 rounded-full mt-0.5" />
								<div className="flex-1 space-y-1">
									<Skeleton className="h-3.5 w-3/4" />
									<Skeleton className="h-2.5 w-1/2" />
								</div>
							</div>
						))}
					</div>
					<div className="space-y-4">
						<Skeleton className="h-40" />
						<Skeleton className="h-48" />
					</div>
				</div>
			</div>
		</div>
	);
}
