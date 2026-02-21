"use client";

import { Result, useAtomValue } from "@effect-atom/atom-react";
import {
	AlertCircle,
	Check,
	CircleDot,
	FileDiff,
	GitBranch,
	GitCommitHorizontal,
	GitPullRequest,
	Loader2,
	Play,
	ShieldCheck,
	Zap,
} from "@packages/ui/components/icons";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { Option } from "effect";
import { type ComponentType, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SyncProgress = {
	readonly state: "pending" | "running" | "retry" | "done" | "failed";
	readonly currentStep: string | null;
	readonly completedSteps: ReadonlyArray<string>;
	readonly itemsFetched: number;
	readonly lastError: string | null;
	readonly startedAt: number;
	readonly updatedAt: number;
};

// ---------------------------------------------------------------------------
// Step metadata — mirrors the bootstrapWorkflow step names exactly
// ---------------------------------------------------------------------------

type StepMeta = {
	readonly key: string;
	readonly label: string;
	readonly icon: ComponentType<{ className?: string }>;
};

const SYNC_STEPS: ReadonlyArray<StepMeta> = [
	{ key: "Branches", label: "Branches", icon: GitBranch },
	{ key: "Pull requests", label: "Pull requests", icon: GitPullRequest },
	{ key: "Issues", label: "Issues", icon: CircleDot },
	{ key: "Commits", label: "Commits", icon: GitCommitHorizontal },
	{ key: "Check runs", label: "Checks", icon: ShieldCheck },
	{ key: "Workflows", label: "CI / CD", icon: Zap },
	{ key: "File diffs", label: "Diffs", icon: FileDiff },
];

// ---------------------------------------------------------------------------
// SyncProgressTracker — the visual component
// ---------------------------------------------------------------------------

function SyncProgressTracker({ progress }: { progress: SyncProgress }) {
	const completedSet = new Set(progress.completedSteps);
	const completedCount = progress.completedSteps.length;
	const totalSteps = SYNC_STEPS.length;
	const progressPercent =
		progress.state === "done"
			? 100
			: Math.round((completedCount / totalSteps) * 100);

	const isFailed = progress.state === "failed";
	const isDone = progress.state === "done";

	return (
		<div className="flex h-full items-center justify-center">
			<div className="w-full max-w-md px-6">
				{/* ── Status header ── */}
				<div className="flex items-center gap-2.5 mb-5">
					{!isDone && !isFailed && (
						<div className="relative flex items-center justify-center size-8 rounded-full bg-foreground/5">
							<Loader2 className="size-4 animate-spin text-foreground/60" />
						</div>
					)}
					{isDone && (
						<div className="flex items-center justify-center size-8 rounded-full bg-emerald-500/10">
							<Check className="size-4 text-emerald-500" />
						</div>
					)}
					{isFailed && (
						<div className="flex items-center justify-center size-8 rounded-full bg-destructive/10">
							<AlertCircle className="size-4 text-destructive" />
						</div>
					)}
					<div className="flex-1 min-w-0">
						<p className="text-sm font-medium text-foreground truncate">
							{isDone
								? "Sync complete"
								: isFailed
									? "Sync failed"
									: (progress.currentStep ?? "Preparing sync…")}
						</p>
						{progress.itemsFetched > 0 && (
							<p className="text-xs tabular-nums text-muted-foreground mt-0.5">
								{progress.itemsFetched.toLocaleString()} items fetched
							</p>
						)}
					</div>
				</div>

				{/* ── Progress bar ── */}
				<div className="relative h-1 w-full rounded-full bg-border overflow-hidden mb-6">
					<div
						className={cn(
							"absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out",
							isDone && "bg-emerald-500",
							isFailed && "bg-destructive",
							!isDone && !isFailed && "bg-foreground/50",
						)}
						style={{ width: `${progressPercent}%` }}
					/>
					{/* Shimmer overlay while running */}
					{!isDone && !isFailed && (
						<div className="absolute inset-0 overflow-hidden rounded-full">
							<div className="h-full w-1/3 animate-[shimmer_1.8s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
						</div>
					)}
				</div>

				{/* ── Step indicators ── */}
				<div className="grid grid-cols-7 gap-1">
					{SYNC_STEPS.map((step) => {
						const isCompleted = completedSet.has(step.key);
						const isActive =
							!isCompleted &&
							!isDone &&
							!isFailed &&
							progress.currentStep !== null &&
							progress.currentStep
								.toLowerCase()
								.includes(step.key.toLowerCase().split(" ")[0] ?? "");
						const Icon = step.icon;

						return (
							<div
								key={step.key}
								className="flex flex-col items-center gap-1.5"
							>
								<div
									className={cn(
										"flex items-center justify-center size-7 rounded-full border transition-all duration-500",
										isCompleted &&
											"bg-foreground border-foreground text-background",
										isActive &&
											"border-foreground/50 text-foreground animate-pulse",
										!isCompleted &&
											!isActive &&
											"border-border text-muted-foreground/40",
									)}
								>
									{isCompleted ? (
										<Check className="size-3" />
									) : (
										<Icon className="size-3" />
									)}
								</div>
								<span
									className={cn(
										"text-[10px] leading-tight text-center",
										isCompleted && "text-foreground font-medium",
										isActive && "text-foreground",
										!isCompleted && !isActive && "text-muted-foreground/50",
									)}
								>
									{step.label}
								</span>
							</div>
						);
					})}
				</div>

				{/* ── Error message ── */}
				{isFailed && progress.lastError && (
					<p className="mt-5 text-xs text-destructive/80 leading-relaxed">
						{progress.lastError}
					</p>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// SyncProgressOverlay — subscribes to sync state and conditionally renders
// the tracker, falling back to children (the normal empty-state placeholder)
// ---------------------------------------------------------------------------

export function SyncProgressOverlay({
	owner,
	name,
	children,
}: {
	owner: string;
	name: string;
	children: React.ReactNode;
}) {
	const client = useProjectionQueries();

	const progressAtom = useMemo(
		() => client.getSyncProgress.subscription({ ownerLogin: owner, name }),
		[client, owner, name],
	);

	const progressResult = useAtomValue(progressAtom);

	// Extract progress data from the subscription result
	const progress: SyncProgress | null = (() => {
		const val = Result.value(progressResult);
		if (Option.isNone(val)) return null;
		return val.value;
	})();

	// Show the progress tracker when sync is actively running or recently
	// completed/failed.  "done" state clears quickly once the overview
	// projection appears and the layout stops rendering the detail default.
	const showProgress =
		progress !== null &&
		(progress.state === "running" ||
			progress.state === "retry" ||
			progress.state === "pending" ||
			progress.state === "failed");

	if (showProgress) {
		return <SyncProgressTracker progress={progress} />;
	}

	// Fallback: the normal empty-state placeholder
	return <>{children}</>;
}
