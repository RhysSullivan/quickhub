/**
 * Cron jobs for async webhook processing.
 *
 * Two workers run on a regular cadence:
 *
 * 1. **Process pending** (every 1 second)
 *    Picks up events with processState="pending" and dispatches them
 *    through the handler pipeline. Successful events are marked "processed";
 *    failures get exponential backoff retries.
 *
 * 2. **Promote retries** (every 30 seconds)
 *    Finds events in "retry" state whose backoff window has elapsed
 *    and resets them to "pending" so the next processing pass picks them up.
 *
 * Together these form the async processing loop described in Slice 9:
 *
 *   HTTP webhook  ──▶  persist (pending)  ──▶  cron processes  ──▶  processed
 *                                                  │ failure
 *                                                  ▼
 *                                            retry (backoff)
 *                                                  │ promoted
 *                                                  ▼
 *                                              pending (again)
 *                                                  │ MAX_ATTEMPTS exhausted
 *                                                  ▼
 *                                            dead letters
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Process pending webhook events every second
crons.interval(
	"process pending webhook events",
	{ seconds: 1 },
	internal.rpc.webhookProcessor.processAllPending,
	{},
);

// Promote retry events past their backoff window every 30 seconds
crons.interval(
	"promote retry webhook events",
	{ seconds: 30 },
	internal.rpc.webhookProcessor.promoteRetryEvents,
	{},
);

// Refresh stale GitHub permission snapshots every hour
crons.interval(
	"refresh stale github permissions",
	{ hours: 1 },
	internal.rpc.githubActions.syncStalePermissions,
	{},
);

// Restart bootstraps that have been stuck for 30+ minutes.
crons.interval(
	"restart stuck bootstraps",
	{ minutes: 10 },
	internal.rpc.admin.restartStuckBootstraps,
	{ thresholdMs: 30 * 60 * 1000, restart: true },
);

// Suspend stale/unreachable installations (GitHub returns installation 404).
crons.interval(
	"suspend unreachable installations",
	{ minutes: 30 },
	internal.rpc.admin.suspendUnreachableInstallations,
	{ limit: 20 },
);

export default crons;
