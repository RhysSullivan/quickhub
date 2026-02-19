import actionCache from "@convex-dev/action-cache/convex.config";
import aggregate from "@convex-dev/aggregate/convex.config";
import migrations from "@convex-dev/migrations/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workflow from "@convex-dev/workflow/convex.config.js";
import { defineApp } from "convex/server";
import betterAuth from "./betterAuth/convex.config";

const app: ReturnType<typeof defineApp> = defineApp();
app.use(actionCache);
app.use(betterAuth);
app.use(migrations);
app.use(rateLimiter);
app.use(workflow);

// ---------------------------------------------------------------------------
// Aggregate component instances — O(log n) counts replacing O(n) table scans.
// Each aggregate maintains a B-tree for a specific table+namespace combination.
// ---------------------------------------------------------------------------

// Per-repo counts for overview dashboard
app.use(aggregate, { name: "prsByRepo" });
app.use(aggregate, { name: "issuesByRepo" });
app.use(aggregate, { name: "checkRunsByRepo" });

// Per-entity counts for view projections
app.use(aggregate, { name: "commentsByIssueNumber" });
app.use(aggregate, { name: "reviewsByPrNumber" });
app.use(aggregate, { name: "jobsByWorkflowRun" });

// Webhook queue health counts
app.use(aggregate, { name: "webhooksByState" });

// Note: For admin tableCounts dashboard, we reuse the above aggregates for
// tables that can grow unbounded (PRs, issues, comments, check runs, reviews,
// jobs, webhook events). Smaller tables (repos, branches, users, etc.) keep
// bounded .take() since they're typically <10k rows.

export default app;
