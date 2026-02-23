/**
 * bootstrapWorkflow — Durable workflow for initial repository sync.
 *
 * Orchestrates the individual fetch step-actions defined in `bootstrapSteps.ts`
 * using the Convex Workflow component for durable execution. If any step fails
 * (e.g. due to a GitHub rate limit), it is retried with exponential backoff.
 * Steps that already completed are NOT re-run on retry.
 *
 * Large fetches (PRs, issues) use a cursor-based loop where each chunk is its
 * own durable step. If one chunk times out, only that chunk retries.
 *
 * The workflow also manages the sync job lifecycle (pending → running → done/failed).
 */
import { vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import { workflow } from "../shared/workflow";

const PR_ISSUE_PROGRESS_UPDATE_EVERY_CHUNKS = 5;
const CHECK_RUN_PROGRESS_UPDATE_EVERY_CHUNKS = 5;

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

export const bootstrapRepo = workflow.define({
	args: {
		repositoryId: v.number(),
		fullName: v.string(),
		lockKey: v.string(),
		/** better-auth user ID whose GitHub OAuth token should be used. Null for App-installed repos. */
		connectedByUserId: v.union(v.string(), v.null()),
		/** GitHub App installation ID for fallback token resolution. */
		installationId: v.number(),
	},
	handler: async (step, args): Promise<void> => {
		const s = internal.rpc.bootstrapSteps;
		const progress = internal.rpc.bootstrapWorkflow.updateSyncProgress;
		const { connectedByUserId, installationId } = args;

		// Mark job as running
		await step.runMutation(internal.rpc.bootstrapWorkflow.markSyncJob, {
			lockKey: args.lockKey,
			state: "running",
			lastError: null,
		});

		// Step 1: Fetch branches
		await step.runMutation(progress, {
			lockKey: args.lockKey,
			currentStep: "Fetching branches",
		});
		const branchResult: { count: number } = await step.runAction(
			s.fetchBranches,
			{
				repositoryId: args.repositoryId,
				fullName: args.fullName,
				connectedByUserId,
				installationId,
			},
			{ name: "fetch-branches" },
		);
		await step.runMutation(progress, {
			lockKey: args.lockKey,
			currentStep: null,
			completedStep: "Branches",
			itemsInStep: branchResult.count,
		});

		// Step 2: Fetch pull requests (chunked cursor loop)
		// Each chunk processes PAGES_PER_CHUNK pages (~1000 items), then returns
		// a cursor for the next chunk. Each chunk is its own durable step.
		{
			let prCursor: string | null = null;
			let chunkIndex = 0;
			let totalPrs = 0;
			await step.runMutation(progress, {
				lockKey: args.lockKey,
				currentStep: "Fetching pull requests",
			});
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			while (true) {
				const result: { count: number; nextCursor: string | null } =
					await step.runAction(
						s.fetchPullRequestsChunk,
						{
							repositoryId: args.repositoryId,
							fullName: args.fullName,
							cursor: prCursor,
							connectedByUserId,
							installationId,
						},
						{ name: `fetch-prs-${chunkIndex}` },
					);
				totalPrs += result.count;
				prCursor = result.nextCursor;
				chunkIndex++;
				if (prCursor !== null) {
					// Throttle progress writes to reduce mutation churn for large installs.
					if (chunkIndex % PR_ISSUE_PROGRESS_UPDATE_EVERY_CHUNKS === 0) {
						await step.runMutation(progress, {
							lockKey: args.lockKey,
							currentStep: `Fetching pull requests (${totalPrs} so far)`,
						});
					}
				}
				if (prCursor === null) break;
			}
			await step.runMutation(progress, {
				lockKey: args.lockKey,
				currentStep: null,
				completedStep: "Pull requests",
				itemsInStep: totalPrs,
			});
		}

		// Step 3: Fetch issues (chunked cursor loop)
		{
			let issueCursor: string | null = null;
			let chunkIndex = 0;
			let totalIssues = 0;
			await step.runMutation(progress, {
				lockKey: args.lockKey,
				currentStep: "Fetching issues",
			});
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			while (true) {
				const result: { count: number; nextCursor: string | null } =
					await step.runAction(
						s.fetchIssuesChunk,
						{
							repositoryId: args.repositoryId,
							fullName: args.fullName,
							cursor: issueCursor,
							connectedByUserId,
							installationId,
						},
						{ name: `fetch-issues-${chunkIndex}` },
					);
				totalIssues += result.count;
				issueCursor = result.nextCursor;
				chunkIndex++;
				if (issueCursor !== null) {
					if (chunkIndex % PR_ISSUE_PROGRESS_UPDATE_EVERY_CHUNKS === 0) {
						await step.runMutation(progress, {
							lockKey: args.lockKey,
							currentStep: `Fetching issues (${totalIssues} so far)`,
						});
					}
				}
				if (issueCursor === null) break;
			}
			await step.runMutation(progress, {
				lockKey: args.lockKey,
				currentStep: null,
				completedStep: "Issues",
				itemsInStep: totalIssues,
			});
		}

		// Step 4: Fetch recent commits
		await step.runMutation(progress, {
			lockKey: args.lockKey,
			currentStep: "Fetching commits",
		});
		const commitResult: { count: number } = await step.runAction(
			s.fetchCommits,
			{
				repositoryId: args.repositoryId,
				fullName: args.fullName,
				connectedByUserId,
				installationId,
			},
			{ name: "fetch-commits" },
		);
		await step.runMutation(progress, {
			lockKey: args.lockKey,
			currentStep: null,
			completedStep: "Commits",
			itemsInStep: commitResult.count,
		});

		// Step 5: Read open PRs from DB (written by fetchPullRequestsChunk)
		// and fetch check runs for their head SHAs in chunks.
		await step.runMutation(progress, {
			lockKey: args.lockKey,
			currentStep: "Analyzing check runs",
		});
		const openPrTargets = await step.runAction(
			s.getOpenPrSyncTargets,
			{ repositoryId: args.repositoryId, connectedByUserId, installationId },
			{ name: "get-open-pr-targets" },
		);

		const activePrHeadShas = openPrTargets.map(
			(t: { headSha: string }) => t.headSha,
		);
		const uniqueShas = [...new Set(activePrHeadShas)];

		// Process check runs in chunks of 100 SHAs to stay within action timeout
		{
			const CHECK_RUN_CHUNK_SIZE = 100;
			let totalCheckRuns = 0;
			for (let i = 0; i < uniqueShas.length; i += CHECK_RUN_CHUNK_SIZE) {
				const shaChunk = uniqueShas.slice(i, i + CHECK_RUN_CHUNK_SIZE);
				const chunkIdx = Math.floor(i / CHECK_RUN_CHUNK_SIZE);
				const result: { count: number } = await step.runAction(
					s.fetchCheckRunsChunk,
					{
						repositoryId: args.repositoryId,
						fullName: args.fullName,
						headShas: shaChunk,
						connectedByUserId,
						installationId,
					},
					{ name: `fetch-check-runs-${chunkIdx}` },
				);
				totalCheckRuns += result.count;
				if (
					i + CHECK_RUN_CHUNK_SIZE < uniqueShas.length &&
					(chunkIdx + 1) % CHECK_RUN_PROGRESS_UPDATE_EVERY_CHUNKS === 0
				) {
					await step.runMutation(progress, {
						lockKey: args.lockKey,
						currentStep: `Analyzing check runs (${totalCheckRuns} found, ${Math.min(i + CHECK_RUN_CHUNK_SIZE, uniqueShas.length)}/${uniqueShas.length} PRs)`,
					});
				}
			}
		}
		await step.runMutation(progress, {
			lockKey: args.lockKey,
			currentStep: null,
			completedStep: "Check runs",
		});

		// Step 6: Fetch workflow runs + jobs
		await step.runMutation(progress, {
			lockKey: args.lockKey,
			currentStep: "Fetching CI/CD workflows",
		});
		await step.runAction(
			s.fetchWorkflowRuns,
			{
				repositoryId: args.repositoryId,
				fullName: args.fullName,
				connectedByUserId,
				installationId,
			},
			{ name: "fetch-workflow-runs" },
		);
		await step.runMutation(progress, {
			lockKey: args.lockKey,
			currentStep: null,
			completedStep: "Workflows",
		});

		// Step 7: Schedule PR file syncs for open PRs
		if (openPrTargets.length > 0) {
			await step.runMutation(progress, {
				lockKey: args.lockKey,
				currentStep: "Syncing PR file diffs",
			});
			await step.runAction(
				s.schedulePrFileSyncs,
				{
					repositoryId: args.repositoryId,
					fullName: args.fullName,
					openPrSyncTargets: openPrTargets,
					connectedByUserId,
					installationId,
				},
				{ name: "schedule-pr-file-syncs" },
			);
			await step.runMutation(progress, {
				lockKey: args.lockKey,
				currentStep: null,
				completedStep: "File diffs",
			});
		}

		// Mark job as done
		await step.runMutation(internal.rpc.bootstrapWorkflow.markSyncJob, {
			lockKey: args.lockKey,
			state: "done",
			lastError: null,
		});
	},
});

// ---------------------------------------------------------------------------
// Per-installation concurrency gating.
//
// GitHub rate-limits installation tokens to 5,000 req/hr. To avoid one large
// installation starving others (or blowing through its rate limit), we cap
// how many bootstrap workflows run concurrently per installation.
// ---------------------------------------------------------------------------

/**
 * Max concurrent bootstrap workflows per GitHub installation.
 * With ~5-10 API calls per step and 9 steps, a repo uses ~50-100 requests.
 * At 25 parallel, that's 1,250-2,500 req burst — well within the 5k/hr limit.
 */
const MAX_PER_INSTALLATION = 25;

// ---------------------------------------------------------------------------
// startBootstrap — Called from Confect mutations to kick off the workflow.
//
// This is a vanilla Convex internalMutation so it has access to the raw
// MutationCtx needed by `workflow.start()`.
//
// If the installation is already at its concurrency cap, the sync job stays
// in "pending" state. When a workflow completes, `onBootstrapComplete` drains
// the next pending job for that installation.
// ---------------------------------------------------------------------------

export const startBootstrap = internalMutation({
	args: {
		repositoryId: v.number(),
		fullName: v.string(),
		lockKey: v.string(),
		connectedByUserId: v.union(v.string(), v.null()),
		installationId: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		// Count how many workflows are already running for this installation
		const runningJobs = await ctx.db
			.query("github_sync_jobs")
			.withIndex("by_installationId_and_state", (q) =>
				q.eq("installationId", args.installationId).eq("state", "running"),
			)
			.take(MAX_PER_INSTALLATION + 1);

		if (runningJobs.length >= MAX_PER_INSTALLATION) {
			// At capacity — leave job as "pending", it will be drained later
			return null;
		}

		// Mark job as running before starting the workflow. If it's already
		// running/done/failed, no-op so duplicate schedulings don't start
		// duplicate workflows.
		const job = await ctx.db
			.query("github_sync_jobs")
			.withIndex("by_lockKey", (q) => q.eq("lockKey", args.lockKey))
			.first();
		if (!job || job.state !== "pending") {
			return null;
		}

		await ctx.db.patch(job._id, {
			state: "running",
			updatedAt: Date.now(),
		});

		await workflow.start(
			ctx,
			internal.rpc.bootstrapWorkflow.bootstrapRepo,
			{
				repositoryId: args.repositoryId,
				fullName: args.fullName,
				lockKey: args.lockKey,
				connectedByUserId: args.connectedByUserId,
				installationId: args.installationId,
			},
			{
				onComplete: internal.rpc.bootstrapWorkflow.onBootstrapComplete,
				context: {
					lockKey: args.lockKey,
					installationId: args.installationId,
				},
			},
		);
		return null;
	},
});

// ---------------------------------------------------------------------------
// onBootstrapComplete — Called by the workflow engine when the workflow
// finishes (success, failure, or cancellation).
//
// On failure, marks the sync job as failed so the UI can surface the error.
// ---------------------------------------------------------------------------

export const onBootstrapComplete = internalMutation({
	args: {
		workflowId: vWorkflowId,
		result: v.any(),
		context: v.any(),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const lockKey =
			args.context &&
			typeof args.context === "object" &&
			"lockKey" in args.context
				? String(args.context.lockKey)
				: null;

		// Extract installationId from context (new workflows) or lockKey (legacy)
		let installationId: number | null =
			args.context &&
			typeof args.context === "object" &&
			"installationId" in args.context
				? Number(args.context.installationId)
				: null;

		if (installationId === null && lockKey) {
			// lockKey format: "repo-bootstrap:<installationId>:<repoId>"
			const parts = lockKey.split(":");
			if (parts.length >= 2) {
				const parsed = Number(parts[1]);
				if (!Number.isNaN(parsed)) installationId = parsed;
			}
		}

		if (!lockKey) return null;

		const result =
			args.result && typeof args.result === "object" && "kind" in args.result
				? args.result
				: null;

		if (!result) return null;

		// Only handle failure/cancellation — success is marked inside the workflow
		if (
			result.kind === "error" ||
			result.kind === "failed" ||
			result.kind === "canceled"
		) {
			const errorMessage =
				result.kind === "canceled"
					? "Workflow canceled"
					: String(result.error ?? "Unknown workflow error");

			const job = await ctx.db
				.query("github_sync_jobs")
				.withIndex("by_lockKey", (q) => q.eq("lockKey", lockKey))
				.first();

			if (job) {
				await ctx.db.patch(job._id, {
					state: "failed",
					lastError: errorMessage,
					updatedAt: Date.now(),
				});
			}
		}

		// Drain: kick the next pending job for this installation (if any)
		if (installationId !== null) {
			await ctx.scheduler.runAfter(
				0,
				internal.rpc.bootstrapWorkflow.drainPendingForInstallation,
				{ installationId },
			);
		}

		return null;
	},
});

/**
 * Drain pending sync jobs for the given installation up to available capacity.
 * Schedules `startBootstrap` for each selected job; `startBootstrap` enforces
 * the final concurrency/state checks before starting workflows.
 */
export const drainPendingForInstallation = internalMutation({
	args: { installationId: v.number() },
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const runningJobs = await ctx.db
			.query("github_sync_jobs")
			.withIndex("by_installationId_and_state", (q) =>
				q.eq("installationId", args.installationId).eq("state", "running"),
			)
			.take(MAX_PER_INSTALLATION + 1);

		const availableSlots = MAX_PER_INSTALLATION - runningJobs.length;
		if (availableSlots <= 0) return null;

		const pendingJobs = await ctx.db
			.query("github_sync_jobs")
			.withIndex(
				"by_installationId_and_state_and_prioritySortKey_and_createdAt",
				(q) =>
					q.eq("installationId", args.installationId).eq("state", "pending"),
			)
			.take(availableSlots * 3);

		let scheduledCount = 0;
		for (const pendingJob of pendingJobs) {
			if (scheduledCount >= availableSlots) break;
			const repositoryId = pendingJob.repositoryId;
			if (repositoryId === null) continue;

			const repo = await ctx.db
				.query("github_repositories")
				.withIndex("by_githubRepoId", (q) => q.eq("githubRepoId", repositoryId))
				.first();

			if (!repo) continue;

			await ctx.scheduler.runAfter(
				0,
				internal.rpc.bootstrapWorkflow.startBootstrap,
				{
					repositoryId: repo.githubRepoId,
					fullName: repo.fullName,
					lockKey: pendingJob.lockKey,
					connectedByUserId: repo.connectedByUserId ?? null,
					installationId: args.installationId,
				},
			);
			scheduledCount++;
		}

		return null;
	},
});

// ---------------------------------------------------------------------------
// Helper mutation: update sync job state
//
// This is a thin wrapper that the workflow calls via step.runMutation().
// ---------------------------------------------------------------------------

export const markSyncJob = internalMutation({
	args: {
		lockKey: v.string(),
		state: v.union(
			v.literal("pending"),
			v.literal("running"),
			v.literal("retry"),
			v.literal("done"),
			v.literal("failed"),
		),
		lastError: v.union(v.string(), v.null()),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		// Find the sync job by lockKey
		const job = await ctx.db
			.query("github_sync_jobs")
			.withIndex("by_lockKey", (q) => q.eq("lockKey", args.lockKey))
			.first();

		if (!job) return null;

		await ctx.db.patch(job._id, {
			state: args.state,
			lastError: args.lastError,
			attemptCount: job.attemptCount + 1,
			updatedAt: Date.now(),
		});

		return null;
	},
});

// ---------------------------------------------------------------------------
// Helper mutation: update sync job progress (step tracking)
//
// Called by the workflow between steps to surface which step is running
// and what has completed so far.
// ---------------------------------------------------------------------------

export const updateSyncProgress = internalMutation({
	args: {
		lockKey: v.string(),
		currentStep: v.union(v.string(), v.null()),
		completedStep: v.optional(v.string()),
		itemsInStep: v.optional(v.number()),
	},
	returns: v.null(),
	handler: async (ctx, args): Promise<null> => {
		const job = await ctx.db
			.query("github_sync_jobs")
			.withIndex("by_lockKey", (q) => q.eq("lockKey", args.lockKey))
			.first();

		if (!job) return null;

		const completedSteps = [...(job.completedSteps ?? [])];
		if (args.completedStep !== undefined) {
			completedSteps.push(args.completedStep);
		}

		const itemsFetched = (job.itemsFetched ?? 0) + (args.itemsInStep ?? 0);

		await ctx.db.patch(job._id, {
			currentStep: args.currentStep,
			completedSteps,
			itemsFetched,
			updatedAt: Date.now(),
		});

		return null;
	},
});

// ---------------------------------------------------------------------------
// queryOpenPrSyncTargets — Internal query to read open PRs from DB.
//
// Called by the getOpenPrSyncTargets action in bootstrapSteps to avoid
// passing large arrays through the workflow journal.
// ---------------------------------------------------------------------------

export const queryOpenPrSyncTargets = internalQuery({
	args: {
		repositoryId: v.number(),
	},
	returns: v.array(
		v.object({
			pullRequestNumber: v.number(),
			headSha: v.string(),
		}),
	),
	handler: async (
		ctx,
		args,
	): Promise<Array<{ pullRequestNumber: number; headSha: string }>> => {
		const openPrs = await ctx.db
			.query("github_pull_requests")
			.withIndex("by_repositoryId_and_state_and_githubUpdatedAt", (q) =>
				q.eq("repositoryId", args.repositoryId).eq("state", "open"),
			)
			.collect();

		return openPrs
			.filter((pr) => pr.headSha !== "")
			.map((pr) => ({
				pullRequestNumber: pr.number,
				headSha: pr.headSha,
			}));
	},
});
