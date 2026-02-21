"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import { Button } from "@packages/ui/components/button";
import { Loader2 } from "@packages/ui/components/icons";
import { Link } from "@packages/ui/components/link";
import { useInfinitePaginationWithInitial } from "@packages/ui/hooks/use-paginated-atom";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

const PAGE_SIZE = 30;

type WorkflowRunItem = {
	readonly githubRunId: number;
	readonly workflowName: string | null;
	readonly runNumber: number;
	readonly event: string;
	readonly status: string | null;
	readonly conclusion: string | null;
	readonly headBranch: string | null;
	readonly headSha: string;
	readonly actorLogin: string | null;
	readonly actorAvatarUrl: string | null;
	readonly jobCount: number;
	readonly htmlUrl: string | null;
	readonly createdAt: number;
	readonly updatedAt: number;
};

export function WorkflowRunListClient({
	owner,
	name,
	initialData = [],
}: {
	owner: string;
	name: string;
	initialData?: ReadonlyArray<WorkflowRunItem>;
}) {
	const [statusFilter, setStatusFilter] = useState<
		"all" | "in_progress" | "completed" | "failure"
	>("all");

	return (
		<div className="p-1.5">
			<div className="flex gap-0.5 mb-1.5 px-1">
				{(["all", "in_progress", "completed", "failure"] as const).map((f) => (
					<Button
						key={f}
						variant={statusFilter === f ? "default" : "ghost"}
						size="sm"
						className="h-6 text-[10px] px-2 font-medium"
						onClick={() => setStatusFilter(f)}
					>
						{f === "all"
							? "All"
							: f === "in_progress"
								? "Running"
								: f === "completed"
									? "Success"
									: "Failed"}
					</Button>
				))}
			</div>

			<WorkflowRunListLoaded
				owner={owner}
				name={name}
				initialData={initialData}
				statusFilter={statusFilter}
			/>
		</div>
	);
}

function WorkflowRunListLoaded({
	owner,
	name,
	initialData,
	statusFilter,
}: {
	owner: string;
	name: string;
	initialData: ReadonlyArray<WorkflowRunItem>;
	statusFilter: "all" | "in_progress" | "completed" | "failure";
}) {
	const client = useProjectionQueries();
	const paginatedAtom = useMemo(
		() =>
			client.listWorkflowRunsPaginated.paginated(PAGE_SIZE, {
				ownerLogin: owner,
				name,
			}),
		[client, owner, name],
	);
	const pagination = useInfinitePaginationWithInitial(
		paginatedAtom,
		initialData,
	);

	const allRuns = pagination.items;
	const isLoading = pagination.isLoading;

	const runs = useMemo(() => {
		if (statusFilter === "all") return allRuns;
		if (statusFilter === "in_progress") {
			return allRuns.filter(
				(r) => r.status === "in_progress" || r.status === "queued",
			);
		}
		if (statusFilter === "completed") {
			return allRuns.filter(
				(r) => r.conclusion === "success" && r.status === "completed",
			);
		}
		return allRuns.filter(
			(r) =>
				r.conclusion === "failure" ||
				r.conclusion === "cancelled" ||
				r.conclusion === "timed_out",
		);
	}, [allRuns, statusFilter]);

	const pathname = usePathname();
	const activeRunNumber = (() => {
		const match = /\/actions\/(\d+)/.exec(pathname);
		return match?.[1] ? Number.parseInt(match[1], 10) : null;
	})();

	return (
		<>
			{runs.length === 0 && !isLoading && (
				<p className="px-2 py-8 text-xs text-muted-foreground text-center">
					No{" "}
					{statusFilter !== "all"
						? statusFilter === "in_progress"
							? "running"
							: statusFilter
						: ""}{" "}
					workflow runs.
				</p>
			)}

			{runs.map((run) => (
				<Link
					key={run.githubRunId}
					href={`/${owner}/${name}/actions/${run.runNumber}`}
					className={cn(
						"flex items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors no-underline",
						activeRunNumber === run.runNumber
							? "bg-accent text-accent-foreground"
							: "hover:bg-accent/50",
					)}
				>
					<ConclusionIcon status={run.status} conclusion={run.conclusion} />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							<span className="font-medium text-xs truncate leading-tight">
								{run.workflowName ?? `Run #${run.runNumber}`}
							</span>
						</div>
						<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5 tabular-nums">
							<span>#{run.runNumber}</span>
							{run.headBranch && (
								<>
									<span className="text-muted-foreground/40">&middot;</span>
									<code className="text-[9px] bg-muted px-1 rounded">
										{run.headBranch}
									</code>
								</>
							)}
							{run.actorLogin && (
								<>
									<span className="text-muted-foreground/40">&middot;</span>
									<span className="flex items-center gap-0.5">
										<Avatar className="size-3">
											<AvatarImage src={run.actorAvatarUrl ?? undefined} />
											<AvatarFallback className="text-[6px]">
												{run.actorLogin[0]?.toUpperCase()}
											</AvatarFallback>
										</Avatar>
										{run.actorLogin}
									</span>
								</>
							)}
							<span className="text-muted-foreground/40">&middot;</span>
							<span>{formatRelative(run.updatedAt)}</span>
						</div>
					</div>
				</Link>
			))}

			<div ref={pagination.sentinelRef} className="h-1" />

			<div className="py-2">
				{pagination.hasMore && (
					<div className="flex items-center justify-center">
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-[10px]"
							disabled={isLoading}
							onClick={() => pagination.loadMore()}
						>
							{isLoading ? (
								<>
									<Loader2 className="size-3 animate-spin" />
									Loading...
								</>
							) : (
								"Load more"
							)}
						</Button>
					</div>
				)}
				{!pagination.hasMore && isLoading && (
					<div className="flex items-center justify-center py-3">
						<Loader2 className="size-4 animate-spin text-muted-foreground" />
					</div>
				)}
			</div>
		</>
	);
}

function ConclusionIcon({
	status,
	conclusion,
}: {
	status: string | null;
	conclusion: string | null;
}) {
	if (status === "in_progress" || status === "queued")
		return (
			<div className="mt-0.5 size-3.5 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin" />
		);
	if (conclusion === "success")
		return (
			<svg
				className="mt-0.5 size-3.5 text-green-600"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
			</svg>
		);
	if (conclusion === "failure")
		return (
			<svg
				className="mt-0.5 size-3.5 text-red-600"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
			</svg>
		);
	if (conclusion === "cancelled")
		return (
			<div className="mt-0.5 size-3.5 rounded-full bg-muted-foreground/30" />
		);
	return (
		<div className="mt-0.5 size-3.5 rounded-full border-2 border-muted-foreground" />
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
