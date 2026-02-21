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
import { Card, CardContent, CardHeader } from "@packages/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@packages/ui/components/dropdown-menu";
import {
	AlertTriangle,
	Ban,
	Check,
	ChevronDown,
	Clock,
	Copy,
	ExternalLink,
	GitBranch,
	Loader2,
	Play,
	RefreshCw,
	RotateCcw,
} from "@packages/ui/components/icons";
import { Input } from "@packages/ui/components/input";
import { Link } from "@packages/ui/components/link";
import { Separator } from "@packages/ui/components/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@packages/ui/components/tooltip";
import { cn } from "@packages/ui/lib/utils";
import { useGithubActions } from "@packages/ui/rpc/github-actions";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { Option } from "effect";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";

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
	readonly workflowId: number;
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

type Step = {
	readonly name: string;
	readonly status: string;
	readonly conclusion: string | null;
	readonly number: number;
	readonly started_at: string | null;
	readonly completed_at: string | null;
};

type CopyMode = "agent" | "cli" | "raw";

const COPY_MODE_KEY = "quickhub:logs-copy-mode";

function getLastCopyMode(): CopyMode {
	if (typeof window === "undefined") return "raw";
	const stored = window.localStorage.getItem(COPY_MODE_KEY);
	if (stored === "agent" || stored === "cli" || stored === "raw") return stored;
	return "raw";
}

function setLastCopyMode(mode: CopyMode) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(COPY_MODE_KEY, mode);
}

export function WorkflowRunDetailClient({
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
				<div className="flex items-start gap-2.5">
					<RunConclusionIconLarge
						status={run.status}
						conclusion={run.conclusion}
					/>
					<div className="min-w-0 flex-1">
						<h1 className="text-base font-bold break-words leading-snug tracking-tight">
							{run.workflowName ?? `Workflow Run`}
						</h1>
						<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
							<span className="tabular-nums">#{run.runNumber}</span>
							<RunStatusBadge status={run.status} conclusion={run.conclusion} />
							{run.actorLogin && (
								<span className="flex items-center gap-1">
									<Avatar className="size-4">
										<AvatarImage src={run.actorAvatarUrl ?? undefined} />
										<AvatarFallback className="text-[8px]">
											{run.actorLogin[0]?.toUpperCase()}
										</AvatarFallback>
									</Avatar>
									<span className="font-medium">{run.actorLogin}</span>
								</span>
							)}
							<span className="text-muted-foreground/40">&middot;</span>
							<span>{formatRelative(run.updatedAt)}</span>
						</div>
					</div>
					{run.htmlUrl && (
						<Link
							href={run.htmlUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
							aria-label="View on GitHub"
						>
							<ExternalLink className="size-4" />
						</Link>
					)}
				</div>

				{/* Metadata row */}
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{run.headBranch && (
						<Badge variant="outline" className="text-[10px] gap-1">
							<GitBranch className="size-3" />
							{run.headBranch}
						</Badge>
					)}
					<Badge variant="outline" className="text-[10px] font-mono">
						{run.headSha.slice(0, 7)}
					</Badge>
					<Badge variant="outline" className="text-[10px] gap-1">
						<Play className="size-3" />
						{run.event}
					</Badge>
					{run.runAttempt > 1 && (
						<Badge variant="outline" className="text-[10px]">
							Attempt #{run.runAttempt}
						</Badge>
					)}
				</div>

				{/* Actions control bar */}
				<RunControlBar
					owner={owner}
					name={name}
					githubRunId={run.githubRunId}
					workflowId={run.workflowId}
					headBranch={run.headBranch}
					status={run.status}
					conclusion={run.conclusion}
				/>

				{/* Jobs */}
				{run.jobs.length > 0 && (
					<div className="mt-5">
						<h2 className="text-sm font-semibold mb-2">
							Jobs
							<span className="ml-2 text-xs font-normal text-muted-foreground">
								({run.jobs.length})
							</span>
						</h2>
						<div className="space-y-2">
							{run.jobs.map((job) => (
								<JobCard
									key={job.githubJobId}
									job={job}
									owner={owner}
									name={name}
									githubRunId={run.githubRunId}
								/>
							))}
						</div>
					</div>
				)}

				{run.jobs.length === 0 && (
					<p className="mt-5 py-8 text-center text-xs text-muted-foreground">
						No jobs recorded for this run.
					</p>
				)}
			</div>
		</div>
	);
}

function JobCard({
	job,
	owner,
	name,
	githubRunId,
}: {
	job: WorkflowJob;
	owner: string;
	name: string;
	githubRunId: number;
}) {
	const [expanded, setExpanded] = useState(false);
	const hasSteps =
		job.stepsJson !== null && job.stepsJson !== "" && job.stepsJson !== "[]";
	const steps = useMemo(
		() => (expanded ? parseSteps(job.stepsJson) : []),
		[expanded, job.stepsJson],
	);
	const duration = computeDuration(job.startedAt, job.completedAt);
	const logsUrl = `https://github.com/${owner}/${name}/actions/runs/${githubRunId}/job/${job.githubJobId}`;

	return (
		<Card>
			<CardHeader className="pb-0">
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						type="button"
						className="h-auto w-full min-w-0 flex-1 cursor-pointer justify-start gap-2 p-0 text-left hover:bg-transparent"
						onClick={() => setExpanded((prev) => !prev)}
					>
						<JobConclusionIcon
							status={job.status}
							conclusion={job.conclusion}
						/>
						<span className="text-sm font-medium truncate flex-1">
							{job.name}
						</span>
						{duration && (
							<span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
								<Clock className="size-3" />
								{duration}
							</span>
						)}
						{job.conclusion && <ConclusionBadge conclusion={job.conclusion} />}
						{hasSteps && (
							<ChevronDown
								className={cn(
									"size-3.5 text-muted-foreground transition-transform duration-200 shrink-0",
									expanded && "rotate-180",
								)}
							/>
						)}
					</Button>
					<Link
						href={logsUrl}
						target="_blank"
						rel="noopener noreferrer"
						title="Open logs on GitHub"
						className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
					>
						<ExternalLink className="size-3.5" />
						<span className="sr-only">Open logs on GitHub</span>
					</Link>
				</div>
			</CardHeader>
			{expanded && (
				<CardContent>
					{steps.length > 0 && (
						<div className="mt-2 border rounded-md divide-y">
							{steps.map((step) => (
								<div
									key={step.number}
									className="flex items-center gap-2 px-2.5 py-1.5"
								>
									<StepConclusionIcon conclusion={step.conclusion} />
									<span className="text-xs truncate flex-1">{step.name}</span>
									{step.started_at && step.completed_at && (
										<span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
											{computeDuration(
												new Date(step.started_at).getTime(),
												new Date(step.completed_at).getTime(),
											)}
										</span>
									)}
								</div>
							))}
						</div>
					)}
					{job.runnerName && (
						<p className="mt-2 text-[10px] text-muted-foreground">
							Runner: {job.runnerName}
						</p>
					)}

					<JobLogsPanel
						owner={owner}
						name={name}
						githubRunId={githubRunId}
						githubJobId={job.githubJobId}
						jobName={job.name}
						jobConclusion={job.conclusion}
						steps={steps}
					/>
				</CardContent>
			)}
		</Card>
	);
}

function JobLogsPanel({
	owner,
	name,
	githubRunId,
	githubJobId,
	jobName,
	jobConclusion,
	steps,
}: {
	owner: string;
	name: string;
	githubRunId: number;
	githubJobId: number;
	jobName: string;
	jobConclusion: string | null;
	steps: readonly Step[];
}) {
	const githubActions = useGithubActions();
	const [refreshCount, setRefreshCount] = useState(0);
	const logsAtom = useMemo(() => {
		void refreshCount;
		return githubActions.fetchWorkflowJobLogs.callAsQuery({
			ownerLogin: owner,
			name,
			jobId: githubJobId,
		});
	}, [githubActions, owner, name, githubJobId, refreshCount]);
	const logsResult = useAtomValue(logsAtom);
	const [logFilter, setLogFilter] = useState("");
	const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
		"idle",
	);
	const [copyMode, setCopyModeState] = useState<CopyMode>(getLastCopyMode);
	const [dropdownOpen, setDropdownOpen] = useState(false);

	const setCopyMode = useCallback((mode: CopyMode) => {
		setCopyModeState(mode);
		setLastCopyMode(mode);
	}, []);

	const logsValue = Result.value(logsResult);
	const logsError = Result.error(logsResult);
	const isLogsLoading = Result.isWaiting(logsResult);
	const hasLogsResult = Option.isSome(logsValue);
	const logPayload = hasLogsResult ? logsValue.value : null;
	const filteredLog = useMemo(() => {
		if (logPayload === null) return null;
		const query = logFilter.trim().toLowerCase();
		if (query === "") return logPayload.log;
		return logPayload.log
			.split("\n")
			.filter((line) => line.toLowerCase().includes(query))
			.join("\n");
	}, [logPayload, logFilter]);

	useEffect(() => {
		if (copyState !== "copied") return;
		const timeout = window.setTimeout(() => setCopyState("idle"), 1200);
		return () => window.clearTimeout(timeout);
	}, [copyState]);

	const buildAgentPrompt = useCallback(() => {
		const failedSteps = steps.filter((s) => s.conclusion === "failure");
		const lines = [
			`Repository: ${owner}/${name}`,
			`Run ID: ${githubRunId}`,
			`Job: ${jobName}`,
			`Job Conclusion: ${jobConclusion ?? "unknown"}`,
		];
		if (failedSteps.length > 0) {
			lines.push("");
			lines.push("Failed steps:");
			for (const s of failedSteps) {
				lines.push(`  - Step ${s.number}: ${s.name}`);
			}
		}
		if (filteredLog) {
			lines.push("");
			lines.push("--- Logs ---");
			lines.push(filteredLog);
		}
		return lines.join("\n");
	}, [owner, name, githubRunId, jobName, jobConclusion, steps, filteredLog]);

	const buildCliCommand = useCallback(() => {
		return `gh run view ${githubRunId} --repo ${owner}/${name} --job ${githubJobId} --log`;
	}, [owner, name, githubRunId, githubJobId]);

	const copyText = useCallback(
		(mode: CopyMode) => {
			let text: string;
			switch (mode) {
				case "agent":
					text = buildAgentPrompt();
					break;
				case "cli":
					text = buildCliCommand();
					break;
				case "raw":
					if (filteredLog === null) return;
					text = filteredLog;
					break;
			}
			navigator.clipboard
				.writeText(text)
				.then(() => setCopyState("copied"))
				.catch(() => setCopyState("error"));
		},
		[buildAgentPrompt, buildCliCommand, filteredLog],
	);

	const handleCopyDefault = useCallback(() => {
		copyText(copyMode);
	}, [copyText, copyMode]);

	const handleCopyWithMode = useCallback(
		(mode: CopyMode) => {
			setCopyMode(mode);
			copyText(mode);
		},
		[setCopyMode, copyText],
	);

	const handleDownloadLogs = () => {
		if (filteredLog === null) return;
		const blob = new Blob([filteredLog], { type: "text/plain;charset=utf-8" });
		const objectUrl = window.URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = objectUrl;
		anchor.download = `${owner}-${name}-run-${githubRunId}-job-${githubJobId}.log`;
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		window.URL.revokeObjectURL(objectUrl);
	};

	const isCopyDisabled =
		copyMode === "raw" ? filteredLog === null || isLogsLoading : isLogsLoading;

	const copyButtonLabel =
		copyState === "copied"
			? "Copied"
			: copyState === "error"
				? "Retry"
				: "Copy";

	return (
		<div className="mt-3 border rounded-md bg-muted/20">
			<div className="flex items-center justify-between gap-2 border-b px-2.5 py-2">
				<span className="text-[10px] font-semibold tracking-wide text-muted-foreground">
					Logs
				</span>
				<div className="flex items-center gap-1.5">
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[10px]"
						disabled={isLogsLoading}
						onClick={() => setRefreshCount((current) => current + 1)}
					>
						{isLogsLoading ? (
							<>
								<Loader2 className="size-3 animate-spin" />
								Fetching...
							</>
						) : hasLogsResult ? (
							"Refresh"
						) : (
							"Load logs"
						)}
					</Button>
					<div className="flex items-center">
						<Button
							variant="ghost"
							size="sm"
							className="h-6 rounded-r-none px-2 text-[10px]"
							disabled={isCopyDisabled}
							onClick={handleCopyDefault}
						>
							<Copy className="size-3" />
							{copyButtonLabel}
						</Button>
						<DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="h-6 rounded-l-none border-l border-border/40 px-1 text-[10px]"
									disabled={isLogsLoading}
								>
									<ChevronDown className="size-3" />
									<span className="sr-only">Copy options</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="min-w-48">
								<DropdownMenuItem
									onClick={() => handleCopyWithMode("agent")}
									disabled={isLogsLoading}
								>
									<span className="flex items-center justify-between w-full gap-2">
										<span>Copy for your agent</span>
										{copyMode === "agent" && (
											<Check className="size-3 text-muted-foreground" />
										)}
									</span>
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => handleCopyWithMode("cli")}
									disabled={isLogsLoading}
								>
									<span className="flex items-center justify-between w-full gap-2">
										<span>Copy CLI command</span>
										{copyMode === "cli" && (
											<Check className="size-3 text-muted-foreground" />
										)}
									</span>
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => handleCopyWithMode("raw")}
									disabled={filteredLog === null || isLogsLoading}
								>
									<span className="flex items-center justify-between w-full gap-2">
										<span>Copy raw</span>
										{copyMode === "raw" && (
											<Check className="size-3 text-muted-foreground" />
										)}
									</span>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[10px]"
						disabled={filteredLog === null || isLogsLoading}
						onClick={handleDownloadLogs}
					>
						Download
					</Button>
				</div>
			</div>

			{hasLogsResult && logPayload !== null && (
				<div className="px-2.5 py-2">
					<div className="mb-2 flex items-center gap-2">
						<Input
							value={logFilter}
							onChange={(event) => {
								setLogFilter(event.target.value);
								if (copyState !== "idle") {
									setCopyState("idle");
								}
							}}
							placeholder="Filter logs"
							className="h-7 text-xs"
						/>
						<span className="text-[10px] text-muted-foreground whitespace-nowrap">
							{logFilter.trim() === "" ? "All lines" : "Filtered"}
						</span>
					</div>
					{logPayload.truncated && (
						<p className="mb-2 text-[10px] text-muted-foreground">
							Showing the most recent log output.
						</p>
					)}
					<pre className="max-h-80 overflow-auto rounded bg-background p-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words">
						{filteredLog}
					</pre>
				</div>
			)}

			{hasLogsResult && logPayload === null && (
				<p className="px-2.5 py-3 text-xs text-muted-foreground">
					Logs are unavailable from the API for this job. Use the GitHub link
					for full logs.
				</p>
			)}

			{Option.isSome(logsError) && (
				<p className="px-2.5 py-3 text-xs text-destructive">
					Could not fetch logs right now.
				</p>
			)}

			{!hasLogsResult && Option.isNone(logsError) && !isLogsLoading && (
				<p className="px-2.5 py-3 text-xs text-muted-foreground">
					Load live logs from GitHub on demand.
				</p>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Run control bar — rerun / rerun failed / cancel
// ---------------------------------------------------------------------------

type ControlAction = "rerun" | "rerunFailed" | "cancel" | "dispatch";

type ControlButtonState = "idle" | "pending" | "success" | "error";

function deriveControlState(
	result: Result.Result<{ accepted: boolean }, { message: string }>,
): ControlButtonState {
	if (Result.isWaiting(result)) return "pending";
	if (Option.isSome(Result.error(result))) return "error";
	if (Option.isSome(Result.value(result))) return "success";
	return "idle";
}

function RunControlBar({
	owner,
	name,
	githubRunId,
	workflowId,
	headBranch,
	status,
	conclusion,
}: {
	owner: string;
	name: string;
	githubRunId: number;
	workflowId: number;
	headBranch: string | null;
	status: string | null;
	conclusion: string | null;
}) {
	const githubActions = useGithubActions();

	const [rerunResult, rerunAll] = useAtom(githubActions.rerunWorkflowRun.call);
	const [rerunFailedResult, rerunFailed] = useAtom(
		githubActions.rerunFailedJobs.call,
	);
	const [cancelResult, cancelRun] = useAtom(
		githubActions.cancelWorkflowRun.call,
	);
	const [dispatchResult, dispatchWorkflow] = useAtom(
		githubActions.dispatchWorkflow.call,
	);
	const [dispatchRef, setDispatchRef] = useState(headBranch ?? "main");

	const rerunState = deriveControlState(rerunResult);
	const rerunFailedState = deriveControlState(rerunFailedResult);
	const cancelState = deriveControlState(cancelResult);
	const dispatchState = deriveControlState(dispatchResult);

	const isRunning = status === "in_progress" || status === "queued";
	const isCompleted = status === "completed";
	const hasFailed = conclusion === "failure";

	const handleRerunAll = useCallback(() => {
		rerunAll({ ownerLogin: owner, name, githubRunId });
	}, [rerunAll, owner, name, githubRunId]);

	const handleRerunFailed = useCallback(() => {
		rerunFailed({ ownerLogin: owner, name, githubRunId });
	}, [rerunFailed, owner, name, githubRunId]);

	const handleCancel = useCallback(() => {
		cancelRun({ ownerLogin: owner, name, githubRunId });
	}, [cancelRun, owner, name, githubRunId]);

	const handleDispatch = useCallback(() => {
		const trimmedRef = dispatchRef.trim();
		if (trimmedRef.length === 0) return;
		dispatchWorkflow({
			ownerLogin: owner,
			name,
			workflowId,
			ref: trimmedRef,
		});
	}, [dispatchRef, dispatchWorkflow, name, owner, workflowId]);

	useEffect(() => {
		if (headBranch === null) return;
		if (dispatchRef.trim().length > 0) return;
		setDispatchRef(headBranch);
	}, [dispatchRef, headBranch]);

	const showRerun = isCompleted;
	const showRerunFailed = isCompleted && hasFailed;
	const showCancel = isRunning;
	const showDispatch = workflowId > 0;
	const dispatchRefEmpty = dispatchRef.trim().length === 0;

	if (!showRerun && !showRerunFailed && !showCancel && !showDispatch) {
		return null;
	}

	return (
		<>
			<Separator className="mt-3" />
			<div className="mt-3 flex items-center gap-1.5">
				{showDispatch && (
					<div className="flex items-center gap-1.5">
						<Input
							value={dispatchRef}
							onChange={(event) => setDispatchRef(event.target.value)}
							placeholder="Branch or tag"
							className="h-7 w-32 px-2 text-[11px]"
							disabled={dispatchState === "pending"}
						/>
						<ControlButton
							action="dispatch"
							state={dispatchState}
							onClick={handleDispatch}
							icon={<Play className="size-3" />}
							label="Dispatch"
							tooltip="Trigger this workflow via workflow_dispatch"
							variant="primary"
							disabled={dispatchRefEmpty}
						/>
					</div>
				)}
				{showRerunFailed && (
					<ControlButton
						action="rerunFailed"
						state={rerunFailedState}
						onClick={handleRerunFailed}
						icon={<RotateCcw className="size-3" />}
						label="Re-run failed"
						tooltip="Re-run only the failed jobs in this workflow"
						variant="primary"
					/>
				)}
				{showRerun && (
					<ControlButton
						action="rerun"
						state={rerunState}
						onClick={handleRerunAll}
						icon={<RefreshCw className="size-3" />}
						label="Re-run all"
						tooltip="Re-run all jobs in this workflow"
						variant="secondary"
					/>
				)}
				{showCancel && (
					<ControlButton
						action="cancel"
						state={cancelState}
						onClick={handleCancel}
						icon={<Ban className="size-3" />}
						label="Cancel"
						tooltip="Cancel this in-progress workflow run"
						variant="destructive"
					/>
				)}
			</div>
		</>
	);
}

function ControlButton({
	action,
	state,
	onClick,
	icon,
	label,
	tooltip,
	variant,
	disabled,
}: {
	action: ControlAction;
	state: ControlButtonState;
	onClick: () => void;
	icon: ReactNode;
	label: string;
	tooltip: string;
	variant: "primary" | "secondary" | "destructive";
	disabled?: boolean;
}) {
	const isDisabled = state === "pending" || state === "success" || disabled;

	const variantClasses = {
		primary: cn(
			"border-github-warning/30 bg-github-warning/10 text-github-warning hover:bg-github-warning/20 hover:border-github-warning/50",
		),
		secondary: cn(
			"border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
		),
		destructive: cn(
			"border-github-closed/30 bg-github-closed/10 text-github-closed hover:bg-github-closed/20 hover:border-github-closed/50",
		),
	};

	const stateLabel =
		state === "pending"
			? getProgressLabel(action)
			: state === "success"
				? getSuccessLabel(action)
				: state === "error"
					? "Failed"
					: label;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className={cn(
						"h-7 gap-1.5 px-2.5 text-[11px] font-medium transition-all duration-200",
						variantClasses[variant],
						state === "success" &&
							"border-github-open/30 bg-github-open/10 text-github-open",
						state === "error" &&
							"border-github-closed/30 bg-github-closed/10 text-github-closed",
						isDisabled && "pointer-events-none opacity-60",
					)}
					disabled={isDisabled}
					onClick={onClick}
				>
					{state === "pending" && <Loader2 className="size-3 animate-spin" />}
					{state === "success" && <Check className="size-3" />}
					{state === "error" && <AlertTriangle className="size-3" />}
					{state === "idle" && icon}
					<span>{stateLabel}</span>
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{state === "error" ? "Something went wrong. Try again." : tooltip}
			</TooltipContent>
		</Tooltip>
	);
}

function getProgressLabel(action: ControlAction): string {
	switch (action) {
		case "rerun":
			return "Re-running...";
		case "rerunFailed":
			return "Re-running...";
		case "cancel":
			return "Cancelling...";
		case "dispatch":
			return "Dispatching...";
	}
}

function getSuccessLabel(action: ControlAction): string {
	switch (action) {
		case "rerun":
			return "Re-run queued";
		case "rerunFailed":
			return "Re-run queued";
		case "cancel":
			return "Cancelled";
		case "dispatch":
			return "Dispatch queued";
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSteps(stepsJson: string | null): readonly Step[] {
	if (!stepsJson) return [];
	try {
		return JSON.parse(stepsJson);
	} catch {
		return [];
	}
}

function computeDuration(
	startedAt: number | null,
	completedAt: number | null,
): string | null {
	if (!startedAt || !completedAt) return null;
	const seconds = Math.floor((completedAt - startedAt) / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remaining = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remaining}s`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

function RunConclusionIconLarge({
	status,
	conclusion,
}: {
	status: string | null;
	conclusion: string | null;
}) {
	if (status === "in_progress" || status === "queued")
		return (
			<div className="mt-1 size-5 rounded-full border-2 border-github-warning border-t-transparent animate-spin shrink-0" />
		);
	if (conclusion === "success")
		return (
			<svg
				className="mt-1 size-5 text-github-open shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
			</svg>
		);
	if (conclusion === "failure")
		return (
			<svg
				className="mt-1 size-5 text-github-closed shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
			</svg>
		);
	if (conclusion === "cancelled")
		return (
			<div className="mt-1 size-5 rounded-full bg-muted-foreground/30 shrink-0" />
		);
	return (
		<div className="mt-1 size-5 rounded-full border-2 border-muted-foreground shrink-0" />
	);
}

function RunStatusBadge({
	status,
	conclusion,
}: {
	status: string | null;
	conclusion: string | null;
}) {
	if (status === "in_progress")
		return (
			<Badge className="bg-github-warning hover:bg-github-warning/90 text-[10px]">
				In Progress
			</Badge>
		);
	if (status === "queued")
		return (
			<Badge variant="outline" className="text-[10px]">
				Queued
			</Badge>
		);
	if (conclusion === "success")
		return (
			<Badge className="bg-github-open hover:bg-github-open/90 text-[10px]">
				Success
			</Badge>
		);
	if (conclusion === "failure")
		return (
			<Badge variant="destructive" className="text-[10px]">
				Failed
			</Badge>
		);
	if (conclusion === "cancelled")
		return (
			<Badge variant="secondary" className="text-[10px]">
				Cancelled
			</Badge>
		);
	return (
		<Badge variant="outline" className="text-[10px]">
			{conclusion ?? status ?? "Unknown"}
		</Badge>
	);
}

function ConclusionBadge({ conclusion }: { conclusion: string }) {
	if (conclusion === "success")
		return (
			<Badge variant="secondary" className={cn("text-[10px] text-github-open")}>
				{conclusion}
			</Badge>
		);
	if (conclusion === "failure")
		return (
			<Badge variant="destructive" className="text-[10px]">
				{conclusion}
			</Badge>
		);
	return (
		<Badge variant="outline" className="text-[10px]">
			{conclusion}
		</Badge>
	);
}

function JobConclusionIcon({
	status,
	conclusion,
}: {
	status: string;
	conclusion: string | null;
}) {
	if (status === "in_progress")
		return (
			<div className="size-4 rounded-full border-2 border-github-warning border-t-transparent animate-spin shrink-0" />
		);
	if (conclusion === "success")
		return (
			<svg
				className="size-4 text-github-open shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
			</svg>
		);
	if (conclusion === "failure")
		return (
			<svg
				className="size-4 text-github-closed shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
			</svg>
		);
	if (conclusion === "cancelled" || conclusion === "skipped")
		return (
			<div className="size-4 rounded-full bg-muted-foreground/30 shrink-0" />
		);
	return (
		<div className="size-4 rounded-full border-2 border-muted-foreground shrink-0" />
	);
}

function StepConclusionIcon({ conclusion }: { conclusion: string | null }) {
	if (conclusion === "success")
		return (
			<svg
				className="size-3 text-github-open shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
			</svg>
		);
	if (conclusion === "failure")
		return (
			<svg
				className="size-3 text-github-closed shrink-0"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
			</svg>
		);
	if (conclusion === "skipped")
		return (
			<div className="size-3 rounded-full bg-muted-foreground/20 shrink-0" />
		);
	return (
		<div className="size-3 rounded-full border-2 border-muted-foreground/50 shrink-0" />
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
