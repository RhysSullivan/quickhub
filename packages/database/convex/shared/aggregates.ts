/**
 * Aggregate definitions — O(log n) counters powered by @convex-dev/aggregate.
 *
 * Each aggregate maintains a B-tree that is kept in sync with a Convex table.
 * Write operations (insert/replace/delete) must be called explicitly from
 * mutations that modify the underlying tables (since we use Confect's
 * Effect-based mutations rather than convex-helpers Triggers).
 *
 * Read operations (count/sum) can be called from queries or mutations.
 */
import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api.js";
import type { DataModel } from "../_generated/dataModel.js";

// ---------------------------------------------------------------------------
// Per-repo counts for overview dashboard
// ---------------------------------------------------------------------------

/**
 * Count PRs per repository, keyed by state.
 * Namespace: repositoryId
 * Key: state ("open" | "closed")
 *
 * Usage: `prsByRepo.count(ctx, { namespace: repositoryId, bounds: { lower: { key: "open", inclusive: true }, upper: { key: "open", inclusive: true } } })`
 * Or simply: `prsByRepo.count(ctx, { namespace: repositoryId })` for total count.
 */
export const prsByRepo = new TableAggregate<{
	Namespace: number;
	Key: string;
	DataModel: DataModel;
	TableName: "github_pull_requests";
}>(components.prsByRepo, {
	namespace: (doc) => doc.repositoryId,
	sortKey: (doc) => doc.state,
});

/**
 * Count issues per repository, keyed by state.
 * Namespace: repositoryId
 * Key: state ("open" | "closed")
 */
export const issuesByRepo = new TableAggregate<{
	Namespace: number;
	Key: string;
	DataModel: DataModel;
	TableName: "github_issues";
}>(components.issuesByRepo, {
	namespace: (doc) => doc.repositoryId,
	sortKey: (doc) => doc.state,
});

/**
 * Count check runs per repository, keyed by conclusion.
 * Namespace: repositoryId
 * Key: conclusion (null | "success" | "failure" | etc.)
 *
 * To count failing checks, count all minus (success + skipped + neutral + null).
 */
export const checkRunsByRepo = new TableAggregate<{
	Namespace: number;
	Key: string | null;
	DataModel: DataModel;
	TableName: "github_check_runs";
}>(components.checkRunsByRepo, {
	namespace: (doc) => doc.repositoryId,
	sortKey: (doc) => doc.conclusion,
});

// ---------------------------------------------------------------------------
// Per-entity counts for view projections
// ---------------------------------------------------------------------------

/**
 * Count comments per (repositoryId, issueNumber).
 * Namespace: compound key `${repositoryId}:${issueNumber}`
 * Key: null (we only need counts, no key-based querying)
 */
export const commentsByIssueNumber = new TableAggregate<{
	Namespace: string;
	Key: null;
	DataModel: DataModel;
	TableName: "github_issue_comments";
}>(components.commentsByIssueNumber, {
	namespace: (doc) => `${doc.repositoryId}:${doc.issueNumber}`,
	sortKey: () => null,
});

/**
 * Count reviews per (repositoryId, pullRequestNumber).
 * Namespace: compound key `${repositoryId}:${pullRequestNumber}`
 * Key: null (we only need counts)
 */
export const reviewsByPrNumber = new TableAggregate<{
	Namespace: string;
	Key: null;
	DataModel: DataModel;
	TableName: "github_pull_request_reviews";
}>(components.reviewsByPrNumber, {
	namespace: (doc) => `${doc.repositoryId}:${doc.pullRequestNumber}`,
	sortKey: () => null,
});

/**
 * Count jobs per (repositoryId, githubRunId).
 * Namespace: compound key `${repositoryId}:${githubRunId}`
 * Key: null (we only need counts)
 */
export const jobsByWorkflowRun = new TableAggregate<{
	Namespace: string;
	Key: null;
	DataModel: DataModel;
	TableName: "github_workflow_jobs";
}>(components.jobsByWorkflowRun, {
	namespace: (doc) => `${doc.repositoryId}:${doc.githubRunId}`,
	sortKey: () => null,
});

// ---------------------------------------------------------------------------
// Webhook queue health counts
// ---------------------------------------------------------------------------

/**
 * Count webhook events by processState.
 * Namespace: processState ("pending" | "processed" | "failed" | "retry")
 * Key: null (we only need per-state counts)
 */
export const webhooksByState = new TableAggregate<{
	Namespace: string;
	Key: null;
	DataModel: DataModel;
	TableName: "github_webhook_events_raw";
}>(components.webhooksByState, {
	namespace: (doc) => doc.processState,
	sortKey: () => null,
});

// ---------------------------------------------------------------------------
// Per-table row counters for admin dashboard
// ---------------------------------------------------------------------------

/**
 * Simple row counter for each table. Uses a single aggregate instance
 * where the "namespace" is the table name and we just count.
 *
 * Since TableAggregate is tied to a single Convex table, we can't use one
 * instance for all tables. Instead, we use a DirectAggregate or separate
 * TableAggregate instances. For simplicity, we'll compute admin table counts
 * from the per-table aggregates above plus a few dedicated counters.
 *
 * Tables covered by existing aggregates:
 * - github_pull_requests → prsByRepo.count(ctx) (no namespace = total)
 * - github_issues → issuesByRepo.count(ctx)
 * - github_check_runs → checkRunsByRepo.count(ctx)
 * - github_issue_comments → commentsByIssueNumber.count(ctx)
 * - github_pull_request_reviews → reviewsByPrNumber.count(ctx)
 * - github_workflow_jobs → jobsByWorkflowRun.count(ctx)
 * - github_webhook_events_raw → webhooksByState.count(ctx)
 *
 * Tables needing dedicated counters (tableCounters aggregate):
 * - github_repositories
 * - github_branches
 * - github_commits
 * - github_users
 * - github_sync_jobs
 * - github_installations
 *
 * We use a single Aggregate (not TableAggregate) for these, where
 * the namespace is the table name and the key is the document _id.
 * But since Aggregate needs to be tied to a single component instance
 * and can't span tables, we'll instead just do direct aggregate.count()
 * calls on the existing per-table aggregates and handle the remaining
 * tables separately.
 *
 * For the admin table counts, we only need *approximate* counts for
 * repos/branches/commits/users/sync_jobs/installations. These are
 * typically small (<10k). We'll keep the bounded .take() for those
 * and use aggregates for the tables that can grow unbounded.
 */
