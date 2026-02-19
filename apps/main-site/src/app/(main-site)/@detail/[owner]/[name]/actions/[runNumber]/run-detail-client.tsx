"use client";

import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import { Badge } from "@packages/ui/components/badge";
import { Card, CardContent, CardHeader } from "@packages/ui/components/card";
import { Link } from "@packages/ui/components/link";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import {
	CheckCircle2,
	Circle,
	Clock,
	ExternalLink,
	Loader2,
	XCircle,
} from "lucide-react";
import { useMemo } from "react";

type WorkflowJob = {
	readonly githubJobId: number;
	readonly name: string;
	readonly status: string;
	readonly conclusion: string | null;
	readonly startedAt: number | null;
	readonly completedAt: number | null;
	readonly runnerName: string | null;
	readonly stepsJson: string | null;
};

type WorkflowRunDetail = {
	readonly repositoryId: number;
	readonly githubRunId: number;
	readonly workflowName: string | null;
	readonly runNumber: number;
	readonly runAttempt: number;
	readonly event: string;
	readonly status: string | null;
	readonly conclusion: string | null;
	readonly headBranch: string | null;
	readonly headSha: string;
	readonly actorLogin: string | null;
	readonly actorAvatarUrl: string | null;
	readonly htmlUrl: string | null;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly jobs: readonly WorkflowJob[];
};

export function RunDetailClient({
	owner,
	name,
	runNumber,
	initialRun,
}: {
	owner: string;
	name: string;
	runNumber: number;
	initialRun: WorkflowRunDetail | null;
}) {
	const client = useProjectionQueries();
	const runAtom = useMemo(
		() =>
			client.getWorkflowRunDetail.subscription({
				ownerLogin: owner,
				name,
				runNumber,
			}),
		[client, owner, name, runNumber],
	);

	const run = useSubscriptionWithInitial(runAtom, initialRun);

	if (run === null) {
		return (
			<div className="py-8 text-center">
				<h2 className="text-base font-semibold">Run #{runNumber}</h2>
				<p className="mt-1 text-xs text-muted-foreground">Not synced yet.</p>
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="p-4">
				{/* Header */}
				<div className="flex items-start gap-2">
					<RunConclusionIcon
						status={run.status}
						conclusion={run.conclusion}
						large
					/>
					<div className="min-w-0 flex-1">
						<h1 className="text-lg font-bold break-words leading-tight">
							{run.workflowName ?? `Workflow Run #${run.runNumber}`}
						</h1>
						<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
							<span>#{run.runNumber}</span>
							{run.conclusion && (
								<ConclusionBadge conclusion={run.conclusion} />
							)}
							{!run.conclusion && run.status && (
								<Badge variant="outline" className="text-[10px]">
									{run.status}
								</Badge>
							)}
							{run.actorLogin && (
								<span className="flex items-center gap-1">
									<Avatar className="size-4">
										<AvatarImage src={run.actorAvatarUrl ?? undefined} />
										<AvatarFallback className="text-[8px]">
											{run.actorLogin[0]?.toUpperCase()}
										</AvatarFallback>
									</Avatar>
									{run.actorLogin}
								</span>
							)}
						</div>
					</div>
				</div>

				{/* Metadata */}
				<div className="mt-3 flex flex-wrap gap-1.5">
					<Badge variant="outline" className="text-[10px]">
						{run.event}
					</Badge>
					{run.headBranch && (
						<Badge variant="outline" className="text-[10px] font-mono">
							{run.headBranch}
						</Badge>
					)}
					<Badge variant="outline" className="text-[10px] font-mono">
						{run.headSha.slice(0, 7)}
					</Badge>
					<span className="text-xs text-muted-foreground">
						Attempt {run.runAttempt}
					</span>
					<span className="text-xs text-muted-foreground">
						Updated {formatRelative(run.updatedAt)}
					</span>
					{run.htmlUrl && (
						<Link
							href={run.htmlUrl}
							target="_blank"
							className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 no-underline"
						>
							<ExternalLink className="size-3" />
							GitHub
						</Link>
					)}
				</div>

				{/* Jobs */}
				{run.jobs.length > 0 && (
					<div className="mt-5">
						<h2 className="text-sm font-semibold mb-2">
							Jobs ({run.jobs.length})
						</h2>
						<div className="space-y-2">
							{run.jobs.map((job) => (
								<JobCard key={job.githubJobId} job={job} />
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

// --- Job card ---

function JobCard({ job }: { job: WorkflowJob }) {
	const steps = parseSteps(job.stepsJson);
	const duration = jobDuration(job.startedAt, job.completedAt);

	return (
		<Card>
			<CardHeader className="px-3 py-2">
				<div className="flex items-center gap-2">
					<RunConclusionIcon
						status={job.status}
						conclusion={job.conclusion}
						large={false}
					/>
					<span className="text-xs font-semibold truncate">{job.name}</span>
					{job.conclusion && <ConclusionBadge conclusion={job.conclusion} />}
					{duration && (
						<span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
							<Clock className="size-3" />
							{duration}
						</span>
					)}
				</div>
			</CardHeader>
			{steps.length > 0 && (
				<CardContent className="px-3 pb-2 pt-0">
					<div className="divide-y">
						{steps.map((step, i) => (
							<div key={i} className="flex items-center gap-2 py-1 text-[11px]">
								<StepStatusIcon
									status={step.status}
									conclusion={step.conclusion}
								/>
								<span className="truncate">{step.name}</span>
								{step.conclusion && step.conclusion !== "skipped" && (
									<span
										className={cn(
											"ml-auto text-[10px] shrink-0",
											step.conclusion === "success"
												? "text-green-600"
												: step.conclusion === "failure"
													? "text-red-600"
													: "text-muted-foreground",
										)}
									>
										{step.conclusion}
									</span>
								)}
							</div>
						))}
					</div>
				</CardContent>
			)}
		</Card>
	);
}

// --- Helpers ---

type StepData = {
	name: string;
	status: string;
	conclusion: string | null;
	number: number;
};

function parseSteps(stepsJson: string | null): StepData[] {
	if (!stepsJson) return [];
	try {
		const parsed: readonly {
			name?: string;
			status?: string;
			conclusion?: string | null;
			number?: number;
		}[] = JSON.parse(stepsJson);
		return parsed.map((s, i) => ({
			name: s.name ?? `Step ${i + 1}`,
			status: s.status ?? "unknown",
			conclusion: s.conclusion ?? null,
			number: s.number ?? i + 1,
		}));
	} catch {
		return [];
	}
}

function jobDuration(
	startedAt: number | null,
	completedAt: number | null,
): string | null {
	if (!startedAt || !completedAt) return null;
	const diffSec = Math.floor((completedAt - startedAt) / 1000);
	if (diffSec < 60) return `${diffSec}s`;
	const minutes = Math.floor(diffSec / 60);
	const seconds = diffSec % 60;
	return `${minutes}m ${seconds}s`;
}

function RunConclusionIcon({
	status,
	conclusion,
	large,
}: {
	status: string | null;
	conclusion: string | null;
	large: boolean;
}) {
	const sizeClass = large ? "size-5 mt-1" : "size-3.5";
	if (conclusion === "success")
		return <CheckCircle2 className={`${sizeClass} text-green-600 shrink-0`} />;
	if (conclusion === "failure")
		return <XCircle className={`${sizeClass} text-red-600 shrink-0`} />;
	if (status === "in_progress" || status === "queued")
		return (
			<Loader2
				className={`${sizeClass} text-yellow-500 shrink-0 animate-spin`}
			/>
		);
	return <Circle className={`${sizeClass} text-muted-foreground shrink-0`} />;
}

function StepStatusIcon({
	status,
	conclusion,
}: {
	status: string;
	conclusion: string | null;
}) {
	if (conclusion === "success")
		return <CheckCircle2 className="size-3 text-green-600 shrink-0" />;
	if (conclusion === "failure")
		return <XCircle className="size-3 text-red-600 shrink-0" />;
	if (conclusion === "skipped")
		return <Circle className="size-3 text-muted-foreground/50 shrink-0" />;
	if (status === "in_progress")
		return <Loader2 className="size-3 text-yellow-500 shrink-0 animate-spin" />;
	return <Circle className="size-3 text-muted-foreground shrink-0" />;
}

function ConclusionBadge({ conclusion }: { conclusion: string }) {
	const variant =
		conclusion === "success"
			? "secondary"
			: conclusion === "failure"
				? "destructive"
				: "outline";
	return (
		<Badge
			variant={variant}
			className={cn(
				"text-[10px]",
				conclusion === "success" && "text-green-600",
			)}
		>
			{conclusion}
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
