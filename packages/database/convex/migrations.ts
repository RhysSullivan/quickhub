/**
 * Aggregate backfill migrations.
 *
 * These migrations populate the aggregate B-trees for existing data.
 * They use `insertIfDoesNotExist` which is idempotent — safe to run
 * multiple times (e.g. after a partial failure or restart).
 *
 * Run from the CLI:
 * ```sh
 * npx convex run migrations:run '{"fn": "migrations:backfillPrsByRepo"}'
 * npx convex run migrations:run '{"fn": "migrations:backfillIssuesByRepo"}'
 * npx convex run migrations:run '{"fn": "migrations:backfillCheckRunsByRepo"}'
 * npx convex run migrations:run '{"fn": "migrations:backfillCommentsByIssueNumber"}'
 * npx convex run migrations:run '{"fn": "migrations:backfillReviewsByPrNumber"}'
 * npx convex run migrations:run '{"fn": "migrations:backfillJobsByWorkflowRun"}'
 * npx convex run migrations:run '{"fn": "migrations:backfillWebhooksByState"}'
 * ```
 *
 * Or run all serially:
 * ```sh
 * npx convex run migrations:run '{"fn": "migrations:backfillPrsByRepo", "next": ["migrations:backfillIssuesByRepo", "migrations:backfillCheckRunsByRepo", "migrations:backfillCommentsByIssueNumber", "migrations:backfillReviewsByPrNumber", "migrations:backfillJobsByWorkflowRun", "migrations:backfillWebhooksByState"]}'
 * ```
 */
import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api.js";
// eslint-disable-next-line -- Migrations component requires raw internalMutation from Convex codegen
import { internalMutation } from "./_generated/server";
import {
	checkRunsByRepo,
	commentsByIssueNumber,
	issuesByRepo,
	jobsByWorkflowRun,
	prsByRepo,
	reviewsByPrNumber,
	webhooksByState,
} from "./shared/aggregates";

const migrations = new Migrations(components.migrations, {
	internalMutation,
});

// The migration runner — called from CLI
export const run = migrations.runner();

// ---------------------------------------------------------------------------
// Per-table backfill migrations
// ---------------------------------------------------------------------------

export const backfillPrsByRepo = migrations.define({
	table: "github_pull_requests",
	migrateOne: async (ctx, doc) => {
		await prsByRepo.insertIfDoesNotExist(ctx, doc);
	},
});

export const backfillIssuesByRepo = migrations.define({
	table: "github_issues",
	migrateOne: async (ctx, doc) => {
		await issuesByRepo.insertIfDoesNotExist(ctx, doc);
	},
});

export const backfillCheckRunsByRepo = migrations.define({
	table: "github_check_runs",
	migrateOne: async (ctx, doc) => {
		await checkRunsByRepo.insertIfDoesNotExist(ctx, doc);
	},
});

export const backfillCommentsByIssueNumber = migrations.define({
	table: "github_issue_comments",
	migrateOne: async (ctx, doc) => {
		await commentsByIssueNumber.insertIfDoesNotExist(ctx, doc);
	},
});

export const backfillReviewsByPrNumber = migrations.define({
	table: "github_pull_request_reviews",
	migrateOne: async (ctx, doc) => {
		await reviewsByPrNumber.insertIfDoesNotExist(ctx, doc);
	},
});

export const backfillJobsByWorkflowRun = migrations.define({
	table: "github_workflow_jobs",
	migrateOne: async (ctx, doc) => {
		await jobsByWorkflowRun.insertIfDoesNotExist(ctx, doc);
	},
});

export const backfillWebhooksByState = migrations.define({
	table: "github_webhook_events_raw",
	migrateOne: async (ctx, doc) => {
		await webhooksByState.insertIfDoesNotExist(ctx, doc);
	},
});
