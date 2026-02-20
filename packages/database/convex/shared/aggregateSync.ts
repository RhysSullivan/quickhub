/**
 * Aggregate sync helpers — Effect wrappers for keeping aggregates in sync.
 *
 * These helpers wrap the Promise-based `@convex-dev/aggregate` API in Effect
 * for use within Confect mutation handlers. They use the `rawCtx` field from
 * ConfectMutationCtx to access the raw Convex context required by aggregates.
 *
 * Usage pattern:
 * ```
 * const ctx = yield* ConfectMutationCtx;
 * // After inserting a document:
 * yield* syncPrInsert(ctx.rawCtx, fullDoc);
 * // After replacing (patching) a document:
 * yield* syncPrReplace(ctx.rawCtx, oldDoc, newDoc);
 * ```
 */
import type { GenericDataModel, GenericMutationCtx } from "convex/server";
import { Effect } from "effect";
import type { Doc } from "../_generated/dataModel.js";
import {
	checkRunsByRepo,
	commentsByIssueNumber,
	issuesByRepo,
	jobsByWorkflowRun,
	prsByRepo,
	reviewsByPrNumber,
	webhooksByState,
} from "./aggregates";

type MutCtx = GenericMutationCtx<GenericDataModel>;

const isMissingAggregateComponentError = (error: Error) =>
	error.message.includes('Component "') &&
	error.message.includes("is not registered");

const runAggregateSync = <A>(operation: () => Promise<A>) =>
	Effect.tryPromise({
		try: operation,
		catch: (error) => new Error(String(error)),
	}).pipe(
		Effect.catchAll((error) =>
			isMissingAggregateComponentError(error)
				? Effect.succeed(null)
				: Effect.die(error),
		),
	);

// ---------------------------------------------------------------------------
// Pull Requests
// ---------------------------------------------------------------------------

export const syncPrInsert = (ctx: MutCtx, doc: Doc<"github_pull_requests">) =>
	runAggregateSync(() => prsByRepo.insertIfDoesNotExist(ctx, doc));

export const syncPrReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_pull_requests">,
	newDoc: Doc<"github_pull_requests">,
) => runAggregateSync(() => prsByRepo.replace(ctx, oldDoc, newDoc));

export const syncPrDelete = (ctx: MutCtx, doc: Doc<"github_pull_requests">) =>
	runAggregateSync(() => prsByRepo.delete(ctx, doc));

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export const syncIssueInsert = (ctx: MutCtx, doc: Doc<"github_issues">) =>
	runAggregateSync(() => issuesByRepo.insertIfDoesNotExist(ctx, doc));

export const syncIssueReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_issues">,
	newDoc: Doc<"github_issues">,
) => runAggregateSync(() => issuesByRepo.replace(ctx, oldDoc, newDoc));

export const syncIssueDelete = (ctx: MutCtx, doc: Doc<"github_issues">) =>
	runAggregateSync(() => issuesByRepo.delete(ctx, doc));

// ---------------------------------------------------------------------------
// Check Runs
// ---------------------------------------------------------------------------

export const syncCheckRunInsert = (
	ctx: MutCtx,
	doc: Doc<"github_check_runs">,
) => runAggregateSync(() => checkRunsByRepo.insertIfDoesNotExist(ctx, doc));

export const syncCheckRunReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_check_runs">,
	newDoc: Doc<"github_check_runs">,
) => runAggregateSync(() => checkRunsByRepo.replace(ctx, oldDoc, newDoc));

// ---------------------------------------------------------------------------
// Issue Comments
// ---------------------------------------------------------------------------

export const syncCommentInsert = (
	ctx: MutCtx,
	doc: Doc<"github_issue_comments">,
) =>
	runAggregateSync(() => commentsByIssueNumber.insertIfDoesNotExist(ctx, doc));

export const syncCommentReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_issue_comments">,
	newDoc: Doc<"github_issue_comments">,
) => runAggregateSync(() => commentsByIssueNumber.replace(ctx, oldDoc, newDoc));

export const syncCommentDelete = (
	ctx: MutCtx,
	doc: Doc<"github_issue_comments">,
) => runAggregateSync(() => commentsByIssueNumber.delete(ctx, doc));

// ---------------------------------------------------------------------------
// Pull Request Reviews
// ---------------------------------------------------------------------------

export const syncReviewInsert = (
	ctx: MutCtx,
	doc: Doc<"github_pull_request_reviews">,
) => runAggregateSync(() => reviewsByPrNumber.insertIfDoesNotExist(ctx, doc));

export const syncReviewReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_pull_request_reviews">,
	newDoc: Doc<"github_pull_request_reviews">,
) => runAggregateSync(() => reviewsByPrNumber.replace(ctx, oldDoc, newDoc));

// ---------------------------------------------------------------------------
// Workflow Jobs
// ---------------------------------------------------------------------------

export const syncJobInsert = (ctx: MutCtx, doc: Doc<"github_workflow_jobs">) =>
	runAggregateSync(() => jobsByWorkflowRun.insertIfDoesNotExist(ctx, doc));

export const syncJobReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_workflow_jobs">,
	newDoc: Doc<"github_workflow_jobs">,
) => runAggregateSync(() => jobsByWorkflowRun.replace(ctx, oldDoc, newDoc));

// ---------------------------------------------------------------------------
// Webhook Events
// ---------------------------------------------------------------------------

export const syncWebhookInsert = (
	ctx: MutCtx,
	doc: Doc<"github_webhook_events_raw">,
) => runAggregateSync(() => webhooksByState.insertIfDoesNotExist(ctx, doc));

export const syncWebhookReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_webhook_events_raw">,
	newDoc: Doc<"github_webhook_events_raw">,
) => runAggregateSync(() => webhooksByState.replace(ctx, oldDoc, newDoc));

export const syncWebhookDelete = (
	ctx: MutCtx,
	doc: Doc<"github_webhook_events_raw">,
) => runAggregateSync(() => webhooksByState.delete(ctx, doc));
