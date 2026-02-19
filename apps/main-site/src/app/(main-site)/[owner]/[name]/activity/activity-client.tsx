"use client";

import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import { Badge } from "@packages/ui/components/badge";
import {
	Card,
	CardDescription,
	CardHeader,
} from "@packages/ui/components/card";
import { Link } from "@packages/ui/components/link";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { use, useMemo } from "react";

const PAGE_SIZE = 50;

type ActivityItem = {
	readonly activityType: string;
	readonly title: string;
	readonly description: string | null;
	readonly actorLogin: string | null;
	readonly actorAvatarUrl: string | null;
	readonly entityNumber: number | null;
	readonly createdAt: number;
};

export function ActivityFeedClient({
	owner,
	name,
	initialDataPromise,
}: {
	owner: string;
	name: string;
	initialDataPromise: Promise<readonly ActivityItem[]>;
}) {
	const initialData = use(initialDataPromise);

	const client = useProjectionQueries();
	const activityAtom = useMemo(
		() =>
			client.listActivity.subscription({
				ownerLogin: owner,
				name,
				limit: PAGE_SIZE,
			}),
		[client, owner, name],
	);

	const activities = useSubscriptionWithInitial(activityAtom, initialData);

	return <ActivityFeed owner={owner} name={name} activities={activities} />;
}

// --- Activity feed (pure render, no loading states) ---

function ActivityFeed({
	owner,
	name,
	activities,
}: {
	owner: string;
	name: string;
	activities: readonly ActivityItem[];
}) {
	if (activities.length === 0) {
		return (
			<Card className="mt-4">
				<CardHeader>
					<CardDescription>No activity recorded yet.</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<div className="divide-y rounded-lg border">
			{activities.map((activity, i) => {
				const linkHref = getActivityLink(
					owner,
					name,
					activity.activityType,
					activity.entityNumber,
				);
				const content = (
					<>
						{activity.actorLogin && (
							<Avatar className="mt-0.5 size-5 sm:size-6 shrink-0">
								<AvatarImage src={activity.actorAvatarUrl ?? undefined} />
								<AvatarFallback className="text-[8px]">
									{activity.actorLogin[0]?.toUpperCase()}
								</AvatarFallback>
							</Avatar>
						)}
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs sm:text-sm">
								<Badge
									variant="outline"
									className="text-[10px] sm:text-xs shrink-0"
								>
									{activity.activityType}
								</Badge>
								<span className="font-medium break-words">
									{activity.title}
								</span>
								{activity.entityNumber && (
									<span className="text-muted-foreground">
										#{activity.entityNumber}
									</span>
								)}
							</div>
							{activity.description && (
								<p className="mt-0.5 text-xs sm:text-sm text-muted-foreground truncate">
									{activity.description}
								</p>
							)}
							<span className="text-xs text-muted-foreground">
								{formatRelative(activity.createdAt)}
							</span>
						</div>
					</>
				);

				if (linkHref) {
					return (
						<Link
							key={`${activity.createdAt}-${i}`}
							href={linkHref}
							className="flex items-start gap-2 sm:gap-3 px-3 py-2.5 sm:px-4 sm:py-3 hover:bg-muted/50 transition-colors"
						>
							{content}
						</Link>
					);
				}

				return (
					<div
						key={`${activity.createdAt}-${i}`}
						className="flex items-start gap-2 sm:gap-3 px-3 py-2.5 sm:px-4 sm:py-3"
					>
						{content}
					</div>
				);
			})}
		</div>
	);
}

// --- Helpers ---

function getActivityLink(
	owner: string,
	name: string,
	activityType: string,
	entityNumber: number | null,
): string | null {
	if (entityNumber === null) return null;
	if (activityType.startsWith("pr.") || activityType.startsWith("pr_review.")) {
		return `/${owner}/${name}/pulls/${entityNumber}`;
	}
	if (activityType.startsWith("issue.")) {
		return `/${owner}/${name}/issues/${entityNumber}`;
	}
	if (activityType.startsWith("issue_comment.")) {
		return `/${owner}/${name}/issues/${entityNumber}`;
	}
	return null;
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
