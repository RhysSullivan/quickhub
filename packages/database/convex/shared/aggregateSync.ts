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

// ---------------------------------------------------------------------------
// Pull Requests
// ---------------------------------------------------------------------------

export const syncPrInsert = (ctx: MutCtx, doc: Doc<"github_pull_requests">) =>
	Effect.promise(() => prsByRepo.insertIfDoesNotExist(ctx, doc));

export const syncPrReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_pull_requests">,
	newDoc: Doc<"github_pull_requests">,
) => Effect.promise(() => prsByRepo.replace(ctx, oldDoc, newDoc));

export const syncPrDelete = (ctx: MutCtx, doc: Doc<"github_pull_requests">) =>
	Effect.promise(() => prsByRepo.delete(ctx, doc));

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export const syncIssueInsert = (ctx: MutCtx, doc: Doc<"github_issues">) =>
	Effect.promise(() => issuesByRepo.insertIfDoesNotExist(ctx, doc));

export const syncIssueReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_issues">,
	newDoc: Doc<"github_issues">,
) => Effect.promise(() => issuesByRepo.replace(ctx, oldDoc, newDoc));

export const syncIssueDelete = (ctx: MutCtx, doc: Doc<"github_issues">) =>
	Effect.promise(() => issuesByRepo.delete(ctx, doc));

// ---------------------------------------------------------------------------
// Check Runs
// ---------------------------------------------------------------------------

export const syncCheckRunInsert = (
	ctx: MutCtx,
	doc: Doc<"github_check_runs">,
) => Effect.promise(() => checkRunsByRepo.insertIfDoesNotExist(ctx, doc));

export const syncCheckRunReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_check_runs">,
	newDoc: Doc<"github_check_runs">,
) => Effect.promise(() => checkRunsByRepo.replace(ctx, oldDoc, newDoc));

// ---------------------------------------------------------------------------
// Issue Comments
// ---------------------------------------------------------------------------

export const syncCommentInsert = (
	ctx: MutCtx,
	doc: Doc<"github_issue_comments">,
) => Effect.promise(() => commentsByIssueNumber.insertIfDoesNotExist(ctx, doc));

export const syncCommentReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_issue_comments">,
	newDoc: Doc<"github_issue_comments">,
) => Effect.promise(() => commentsByIssueNumber.replace(ctx, oldDoc, newDoc));

export const syncCommentDelete = (
	ctx: MutCtx,
	doc: Doc<"github_issue_comments">,
) => Effect.promise(() => commentsByIssueNumber.delete(ctx, doc));

// ---------------------------------------------------------------------------
// Pull Request Reviews
// ---------------------------------------------------------------------------

export const syncReviewInsert = (
	ctx: MutCtx,
	doc: Doc<"github_pull_request_reviews">,
) => Effect.promise(() => reviewsByPrNumber.insertIfDoesNotExist(ctx, doc));

export const syncReviewReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_pull_request_reviews">,
	newDoc: Doc<"github_pull_request_reviews">,
) => Effect.promise(() => reviewsByPrNumber.replace(ctx, oldDoc, newDoc));

// ---------------------------------------------------------------------------
// Workflow Jobs
// ---------------------------------------------------------------------------

export const syncJobInsert = (ctx: MutCtx, doc: Doc<"github_workflow_jobs">) =>
	Effect.promise(() => jobsByWorkflowRun.insertIfDoesNotExist(ctx, doc));

export const syncJobReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_workflow_jobs">,
	newDoc: Doc<"github_workflow_jobs">,
) => Effect.promise(() => jobsByWorkflowRun.replace(ctx, oldDoc, newDoc));

// ---------------------------------------------------------------------------
// Webhook Events
// ---------------------------------------------------------------------------

export const syncWebhookInsert = (
	ctx: MutCtx,
	doc: Doc<"github_webhook_events_raw">,
) => Effect.promise(() => webhooksByState.insertIfDoesNotExist(ctx, doc));

export const syncWebhookReplace = (
	ctx: MutCtx,
	oldDoc: Doc<"github_webhook_events_raw">,
	newDoc: Doc<"github_webhook_events_raw">,
) => Effect.promise(() => webhooksByState.replace(ctx, oldDoc, newDoc));

export const syncWebhookDelete = (
	ctx: MutCtx,
	doc: Doc<"github_webhook_events_raw">,
) => Effect.promise(() => webhooksByState.delete(ctx, doc));
