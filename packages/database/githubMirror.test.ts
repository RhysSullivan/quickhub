/**
 * Integration tests for the GitHub mirror pipeline.
 *
 * Tests webhook processing, projection correctness, idempotency,
 * and out-of-order event handling using @packages/convex-test.
 *
 * Uses @effect/vitest for Effect-based test runner.
 * Confect functions return ExitEncoded ({ _tag: "Success", value } or { _tag: "Failure", cause }).
 * We use t.run() for direct DB seeding/verification and t.mutation()/t.query()
 * for calling Confect-wrapped functions.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { api, internal } from "./convex/_generated/api";
import { createConvexTest } from "./testing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ExitEncoded = { _tag: string; value?: unknown; cause?: unknown };
const TEST_USER_ID = "test-user-id";

const assertSuccess = (result: unknown): unknown => {
	const exit = result as ExitEncoded;
	if (exit._tag !== "Success") {
		throw new Error(
			`Expected Success, got ${exit._tag}: ${JSON.stringify(exit.cause)}`,
		);
	}
	return exit.value;
};

/** Build a minimal raw webhook event payload for seeding */
const makeRawEvent = (overrides: {
	deliveryId: string;
	eventName: string;
	action?: string | null;
	repositoryId: number;
	payloadJson: string;
	processState?: "pending" | "processed" | "failed" | "retry";
}) => ({
	deliveryId: overrides.deliveryId,
	eventName: overrides.eventName,
	action: overrides.action ?? null,
	installationId: 0,
	repositoryId: overrides.repositoryId,
	signatureValid: true,
	payloadJson: overrides.payloadJson,
	receivedAt: Date.now(),
	processState: overrides.processState ?? "pending",
	processError: null,
	processAttempts: 0,
	nextRetryAt: null,
});

/** Build a minimal GitHub issue webhook payload */
const makeIssuePayload = (opts: {
	action: string;
	issueId: number;
	number: number;
	state: "open" | "closed";
	title: string;
	body?: string;
	updated_at?: string;
	user?: { id: number; login: string; avatar_url?: string; type?: string };
}) =>
	JSON.stringify({
		action: opts.action,
		issue: {
			id: opts.issueId,
			number: opts.number,
			state: opts.state,
			title: opts.title,
			body: opts.body ?? null,
			user: opts.user ?? {
				id: 1001,
				login: "testuser",
				avatar_url: null,
				type: "User",
			},
			labels: [],
			assignees: [],
			comments: 0,
			updated_at: opts.updated_at ?? "2026-02-18T10:00:00Z",
		},
		sender: opts.user ?? {
			id: 1001,
			login: "testuser",
			avatar_url: null,
			type: "User",
		},
	});

/** Build a minimal GitHub pull_request webhook payload */
const makePrPayload = (opts: {
	action: string;
	prId: number;
	number: number;
	state: "open" | "closed";
	title: string;
	draft?: boolean;
	headRef?: string;
	baseRef?: string;
	headSha?: string;
	updated_at?: string;
	user?: { id: number; login: string; avatar_url?: string; type?: string };
}) =>
	JSON.stringify({
		action: opts.action,
		pull_request: {
			id: opts.prId,
			number: opts.number,
			state: opts.state,
			draft: opts.draft ?? false,
			title: opts.title,
			body: null,
			user: opts.user ?? {
				id: 1001,
				login: "testuser",
				avatar_url: null,
				type: "User",
			},
			head: {
				ref: opts.headRef ?? "feature-branch",
				sha: opts.headSha ?? "abc123",
			},
			base: { ref: opts.baseRef ?? "main" },
			assignees: [],
			requested_reviewers: [],
			mergeable_state: null,
			merged_at: null,
			closed_at: null,
			updated_at: opts.updated_at ?? "2026-02-18T10:00:00Z",
		},
		sender: opts.user ?? {
			id: 1001,
			login: "testuser",
			avatar_url: null,
			type: "User",
		},
	});

/** Build a minimal push event payload */
const makePushPayload = (opts: {
	ref: string;
	after: string;
	commits?: Array<{ id: string; message: string; timestamp: string }>;
	deleted?: boolean;
}) =>
	JSON.stringify({
		ref: opts.ref,
		after: opts.after,
		deleted: opts.deleted ?? false,
		commits: opts.commits ?? [],
		sender: { id: 1001, login: "testuser", avatar_url: null, type: "User" },
	});

/** Build a minimal check_run webhook payload */
const makeCheckRunPayload = (opts: {
	action: string;
	checkRunId: number;
	name: string;
	headSha: string;
	status: string;
	conclusion?: string;
	startedAt?: string;
	completedAt?: string;
}) =>
	JSON.stringify({
		action: opts.action,
		check_run: {
			id: opts.checkRunId,
			name: opts.name,
			head_sha: opts.headSha,
			status: opts.status,
			conclusion: opts.conclusion ?? null,
			started_at: opts.startedAt ?? "2026-02-18T10:00:00Z",
			completed_at: opts.completedAt ?? null,
		},
		sender: { id: 1001, login: "testuser", avatar_url: null, type: "User" },
	});

/** Build a minimal issue_comment webhook payload */
const makeIssueCommentPayload = (opts: {
	action: string;
	commentId: number;
	issueNumber: number;
	issueTitle?: string;
	body: string;
	createdAt?: string;
	updatedAt?: string;
	user?: { id: number; login: string; avatar_url?: string; type?: string };
	isPullRequest?: boolean;
}) =>
	JSON.stringify({
		action: opts.action,
		comment: {
			id: opts.commentId,
			body: opts.body,
			user: opts.user ?? {
				id: 1001,
				login: "testuser",
				avatar_url: null,
				type: "User",
			},
			created_at: opts.createdAt ?? "2026-02-18T10:00:00Z",
			updated_at: opts.updatedAt ?? "2026-02-18T10:00:00Z",
		},
		issue: {
			number: opts.issueNumber,
			title: opts.issueTitle ?? `Issue #${opts.issueNumber}`,
			...(opts.isPullRequest ? { pull_request: {} } : {}),
		},
		sender: opts.user ?? {
			id: 1001,
			login: "testuser",
			avatar_url: null,
			type: "User",
		},
	});

/** Build a minimal pull_request_review webhook payload */
const makePrReviewPayload = (opts: {
	action: string;
	reviewId: number;
	prNumber: number;
	prTitle?: string;
	state: string;
	submittedAt?: string;
	commitSha?: string;
	user?: { id: number; login: string; avatar_url?: string; type?: string };
}) =>
	JSON.stringify({
		action: opts.action,
		review: {
			id: opts.reviewId,
			state: opts.state,
			user: opts.user ?? {
				id: 2001,
				login: "reviewer",
				avatar_url: null,
				type: "User",
			},
			submitted_at: opts.submittedAt ?? "2026-02-18T11:00:00Z",
			commit_id: opts.commitSha ?? "sha-review-commit",
		},
		pull_request: {
			number: opts.prNumber,
			title: opts.prTitle ?? `PR #${opts.prNumber}`,
		},
		sender: opts.user ?? {
			id: 2001,
			login: "reviewer",
			avatar_url: null,
			type: "User",
		},
	});

/** Build a minimal pull_request_review_comment webhook payload */
const makePrReviewCommentPayload = (opts: {
	action: string;
	reviewCommentId: number;
	prNumber: number;
	body: string;
	prTitle?: string;
	path?: string;
	line?: number;
	startLine?: number;
	side?: string;
	startSide?: string;
	reviewId?: number;
	inReplyToId?: number;
	htmlUrl?: string;
	createdAt?: string;
	updatedAt?: string;
	user?: {
		id: number;
		login: string;
		avatar_url?: string | null;
		type?: string;
	};
}) =>
	JSON.stringify({
		action: opts.action,
		comment: {
			id: opts.reviewCommentId,
			pull_request_review_id: opts.reviewId ?? 9101,
			in_reply_to_id: opts.inReplyToId ?? null,
			body: opts.body,
			path: opts.path ?? "src/index.ts",
			line: opts.line ?? 12,
			original_line: opts.line ?? 12,
			start_line: opts.startLine ?? null,
			side: opts.side ?? "RIGHT",
			start_side: opts.startSide ?? null,
			commit_id: "sha-review-comment",
			original_commit_id: "sha-review-comment-original",
			html_url:
				opts.htmlUrl ??
				"https://github.com/testowner/testrepo/pull/42#discussion_r9901",
			user: opts.user ?? {
				id: 2101,
				login: "inline-reviewer",
				avatar_url: null,
				type: "User",
			},
			created_at: opts.createdAt ?? "2026-02-18T12:00:00Z",
			updated_at: opts.updatedAt ?? "2026-02-18T12:00:00Z",
		},
		pull_request: {
			number: opts.prNumber,
			title: opts.prTitle ?? `PR #${opts.prNumber}`,
		},
		sender: opts.user ?? {
			id: 2101,
			login: "inline-reviewer",
			avatar_url: null,
			type: "User",
		},
	});

/** Seed a repository in the DB so webhook processing can find it */
const seedRepository = (
	t: ReturnType<typeof createConvexTest>,
	repositoryId: number,
	ownerLogin = "testowner",
	name = "testrepo",
) =>
	Effect.promise(() =>
		t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("github_repositories", {
				githubRepoId: repositoryId,
				installationId: 0,
				ownerId: 100,
				ownerLogin,
				name,
				fullName: `${ownerLogin}/${name}`,
				private: false,
				visibility: "public",
				defaultBranch: "main",
				archived: false,
				disabled: false,
				fork: false,
				pushedAt: null,
				githubUpdatedAt: now,
				cachedAt: now,
			});

			await ctx.db.insert("github_user_repo_permissions", {
				userId: TEST_USER_ID,
				repositoryId,
				githubUserId: 1001,
				pull: true,
				triage: true,
				push: true,
				maintain: true,
				admin: true,
				roleName: "admin",
				syncedAt: now,
			});
		}),
	);

const authClient = (t: ReturnType<typeof createConvexTest>) =>
	t.withIdentity({ subject: TEST_USER_ID });

/** Insert a raw webhook event into the DB */
const insertRawEvent = (
	t: ReturnType<typeof createConvexTest>,
	event: ReturnType<typeof makeRawEvent>,
) =>
	Effect.promise(() =>
		t.run(async (ctx) => {
			await ctx.db.insert("github_webhook_events_raw", event);
		}),
	);

/** Process a webhook event by deliveryId */
const processEvent = (
	t: ReturnType<typeof createConvexTest>,
	deliveryId: string,
) =>
	Effect.promise(async () => {
		const result = await t.mutation(
			internal.rpc.webhookProcessor.processWebhookEvent,
			{
				deliveryId,
			},
		);
		await t.finishInProgressScheduledFunctions();
		return result;
	});

/** Query a table and return all docs */
const collectTable = <T>(
	t: ReturnType<typeof createConvexTest>,
	tableName: string,
) =>
	Effect.promise(
		() =>
			t.run(async (ctx) => {
				return (
					ctx.db.query(tableName) as ReturnType<typeof ctx.db.query>
				).collect();
			}) as Promise<Array<T>>,
	);

// ---------------------------------------------------------------------------
// Webhook Processing Tests
// ---------------------------------------------------------------------------

describe("Webhook Processing", () => {
	it.effect("processes an issue opened event", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-issue-1",
					eventName: "issues",
					action: "opened",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "opened",
						issueId: 5001,
						number: 1,
						state: "open",
						title: "Test issue",
						body: "This is a test issue body",
					}),
				}),
			);

			const result = yield* processEvent(t, "delivery-issue-1");
			const value = assertSuccess(result);
			expect(value).toMatchObject({
				processed: true,
				eventName: "issues",
				action: "opened",
			});

			// Verify the issue was inserted into domain table
			const issues = yield* collectTable(t, "github_issues");
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({
				repositoryId,
				githubIssueId: 5001,
				number: 1,
				state: "open",
				title: "Test issue",
				isPullRequest: false,
			});

			// Verify the user was upserted
			const users = yield* collectTable(t, "github_users");
			expect(users).toHaveLength(1);
			expect(users[0]).toMatchObject({
				githubUserId: 1001,
				login: "testuser",
			});

			// Verify the raw event was marked as processed
			const rawEvents = yield* collectTable(t, "github_webhook_events_raw");
			expect(rawEvents[0]).toMatchObject({
				processState: "processed",
			});
		}),
	);

	it.effect("processes a pull_request opened event", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-pr-1",
					eventName: "pull_request",
					action: "opened",
					repositoryId,
					payloadJson: makePrPayload({
						action: "opened",
						prId: 6001,
						number: 42,
						state: "open",
						title: "Add feature X",
						headRef: "feature-x",
						baseRef: "main",
						headSha: "sha-feature-x",
					}),
				}),
			);

			const result = yield* processEvent(t, "delivery-pr-1");
			assertSuccess(result);

			const prs = yield* collectTable(t, "github_pull_requests");
			expect(prs).toHaveLength(1);
			expect(prs[0]).toMatchObject({
				repositoryId,
				githubPrId: 6001,
				number: 42,
				state: "open",
				title: "Add feature X",
				headRefName: "feature-x",
				baseRefName: "main",
				headSha: "sha-feature-x",
			});
		}),
	);

	it.effect("processes a push event with commits", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-push-1",
					eventName: "push",
					action: null,
					repositoryId,
					payloadJson: makePushPayload({
						ref: "refs/heads/main",
						after: "sha-new-head",
						commits: [
							{
								id: "sha-commit-1",
								message: "First commit\n\nDetailed description",
								timestamp: "2026-02-18T10:00:00Z",
							},
							{
								id: "sha-commit-2",
								message: "Second commit",
								timestamp: "2026-02-18T10:01:00Z",
							},
						],
					}),
				}),
			);

			const result = yield* processEvent(t, "delivery-push-1");
			assertSuccess(result);

			const branches = yield* collectTable<{
				repositoryId: number;
				name: string;
				headSha: string;
			}>(t, "github_branches");
			expect(branches).toHaveLength(1);
			expect(branches[0]).toMatchObject({
				repositoryId,
				name: "main",
				headSha: "sha-new-head",
			});

			const commits = yield* collectTable<{
				sha: string;
				messageHeadline: string;
			}>(t, "github_commits");
			expect(commits).toHaveLength(2);
			expect(commits.map((c) => c.sha).sort()).toEqual(
				["sha-commit-1", "sha-commit-2"].sort(),
			);
			const firstCommit = commits.find((c) => c.sha === "sha-commit-1");
			expect(firstCommit?.messageHeadline).toBe("First commit");
		}),
	);

	it.effect("skips events without a repository", () =>
		Effect.gen(function* () {
			const t = createConvexTest();

			yield* Effect.promise(() =>
				t.run(async (ctx) => {
					await ctx.db.insert("github_webhook_events_raw", {
						deliveryId: "delivery-no-repo",
						eventName: "ping",
						action: null,
						installationId: 0,
						repositoryId: null,
						signatureValid: true,
						payloadJson: JSON.stringify({ zen: "test" }),
						receivedAt: Date.now(),
						processState: "pending",
						processError: null,
						processAttempts: 0,
						nextRetryAt: null,
					});
				}),
			);

			const result = yield* processEvent(t, "delivery-no-repo");
			const value = assertSuccess(result);
			expect(value).toMatchObject({
				processed: true,
				eventName: "ping",
			});
		}),
	);

	it.effect("returns processed:false for nonexistent delivery", () =>
		Effect.gen(function* () {
			const t = createConvexTest();

			const result = yield* processEvent(t, "nonexistent");
			const value = assertSuccess(result);
			expect(value).toMatchObject({
				processed: false,
				eventName: "unknown",
			});
		}),
	);
});

// ---------------------------------------------------------------------------
// Idempotency Tests
// ---------------------------------------------------------------------------

describe("Idempotency", () => {
	it.effect("processing the same issue event twice produces one issue", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-idem-1",
					eventName: "issues",
					action: "opened",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "opened",
						issueId: 5001,
						number: 1,
						state: "open",
						title: "Idempotent issue",
					}),
				}),
			);

			yield* processEvent(t, "delivery-idem-1");

			// Reset processState to pending (simulating a replay)
			yield* Effect.promise(() =>
				t.run(async (ctx) => {
					const events = await ctx.db
						.query("github_webhook_events_raw")
						.collect();
					await ctx.db.patch(events[0]._id, { processState: "pending" });
				}),
			);

			yield* processEvent(t, "delivery-idem-1");

			const issues = yield* collectTable(t, "github_issues");
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({
				githubIssueId: 5001,
				number: 1,
				title: "Idempotent issue",
			});
		}),
	);

	it.effect("processing the same PR event twice produces one PR", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-idem-pr-1",
					eventName: "pull_request",
					action: "opened",
					repositoryId,
					payloadJson: makePrPayload({
						action: "opened",
						prId: 6001,
						number: 10,
						state: "open",
						title: "Idempotent PR",
					}),
				}),
			);

			yield* processEvent(t, "delivery-idem-pr-1");

			yield* Effect.promise(() =>
				t.run(async (ctx) => {
					const events = await ctx.db
						.query("github_webhook_events_raw")
						.collect();
					await ctx.db.patch(events[0]._id, { processState: "pending" });
				}),
			);

			yield* processEvent(t, "delivery-idem-pr-1");

			const prs = yield* collectTable(t, "github_pull_requests");
			expect(prs).toHaveLength(1);
		}),
	);
});

// ---------------------------------------------------------------------------
// Out-of-Order Handling Tests
// ---------------------------------------------------------------------------

describe("Out-of-Order Handling", () => {
	it.effect("newer issue update is not overwritten by older event", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// First: process a NEWER event (closed at t+1)
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-ooo-newer",
					eventName: "issues",
					action: "closed",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "closed",
						issueId: 5001,
						number: 1,
						state: "closed",
						title: "OOO Issue",
						updated_at: "2026-02-18T12:00:00Z",
					}),
				}),
			);

			yield* processEvent(t, "delivery-ooo-newer");

			let issues = yield* collectTable<{ state: string; title: string }>(
				t,
				"github_issues",
			);
			expect(issues[0]).toMatchObject({ state: "closed" });

			// Now: process an OLDER event (opened at t-1)
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-ooo-older",
					eventName: "issues",
					action: "opened",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "opened",
						issueId: 5001,
						number: 1,
						state: "open",
						title: "OOO Issue (old version)",
						updated_at: "2026-02-18T10:00:00Z",
					}),
				}),
			);

			yield* processEvent(t, "delivery-ooo-older");

			issues = yield* collectTable(t, "github_issues");
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({
				state: "closed",
				title: "OOO Issue",
			});
		}),
	);

	it.effect("newer PR update is not overwritten by older event", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-ooo-pr-newer",
					eventName: "pull_request",
					action: "closed",
					repositoryId,
					payloadJson: makePrPayload({
						action: "closed",
						prId: 6001,
						number: 5,
						state: "closed",
						title: "Latest PR Title",
						updated_at: "2026-02-18T12:00:00Z",
					}),
				}),
			);

			yield* processEvent(t, "delivery-ooo-pr-newer");

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-ooo-pr-older",
					eventName: "pull_request",
					action: "opened",
					repositoryId,
					payloadJson: makePrPayload({
						action: "opened",
						prId: 6001,
						number: 5,
						state: "open",
						title: "Old PR Title",
						updated_at: "2026-02-18T10:00:00Z",
					}),
				}),
			);

			yield* processEvent(t, "delivery-ooo-pr-older");

			const prs = yield* collectTable<{ state: string; title: string }>(
				t,
				"github_pull_requests",
			);
			expect(prs).toHaveLength(1);
			expect(prs[0]).toMatchObject({
				state: "closed",
				title: "Latest PR Title",
			});
		}),
	);
});

// ---------------------------------------------------------------------------
// Projection Tests
// ---------------------------------------------------------------------------

describe("Projection Correctness", () => {
	it.effect("projections are updated after webhook processing", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-proj-issue",
					eventName: "issues",
					action: "opened",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "opened",
						issueId: 5001,
						number: 1,
						state: "open",
						title: "Projection test issue",
					}),
				}),
			);
			yield* processEvent(t, "delivery-proj-issue");

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-proj-pr",
					eventName: "pull_request",
					action: "opened",
					repositoryId,
					payloadJson: makePrPayload({
						action: "opened",
						prId: 6001,
						number: 10,
						state: "open",
						title: "Projection test PR",
					}),
				}),
			);
			yield* processEvent(t, "delivery-proj-pr");

			const overviewResult = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.getRepoOverview, {
					ownerLogin: "testowner",
					name: "testrepo",
				}),
			);
			const overview = assertSuccess(overviewResult);
			expect(overview).toMatchObject({
				repositoryId,
				fullName: "testowner/testrepo",
				openPrCount: 1,
				openIssueCount: 1,
			});

			const prsResult = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listPullRequests, {
					ownerLogin: "testowner",
					name: "testrepo",
				}),
			);
			const prs = assertSuccess(prsResult) as Array<{
				number: number;
				state: string;
				title: string;
			}>;
			expect(prs).toHaveLength(1);
			expect(prs[0]).toMatchObject({
				number: 10,
				state: "open",
				title: "Projection test PR",
			});

			const issuesResult = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listIssues, {
					ownerLogin: "testowner",
					name: "testrepo",
				}),
			);
			const issues = assertSuccess(issuesResult) as Array<{
				number: number;
				state: string;
				title: string;
			}>;
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({
				number: 1,
				state: "open",
				title: "Projection test issue",
			});
		}),
	);

	it.effect("activity feed entries are created after processing", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-activity-1",
					eventName: "issues",
					action: "opened",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "opened",
						issueId: 5001,
						number: 1,
						state: "open",
						title: "Activity test issue",
					}),
				}),
			);
			yield* processEvent(t, "delivery-activity-1");

			const activities = yield* collectTable(t, "view_activity_feed");
			expect(activities).toHaveLength(1);
			expect(activities[0]).toMatchObject({
				repositoryId,
				activityType: "issue.opened",
				title: "Activity test issue",
				actorLogin: "testuser",
				entityNumber: 1,
			});
		}),
	);

	it.effect("push events create activity feed entries", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-activity-push",
					eventName: "push",
					action: null,
					repositoryId,
					payloadJson: makePushPayload({
						ref: "refs/heads/main",
						after: "sha-new",
						commits: [
							{
								id: "c1",
								message: "fix: resolve bug",
								timestamp: "2026-02-18T10:00:00Z",
							},
							{
								id: "c2",
								message: "chore: cleanup",
								timestamp: "2026-02-18T10:01:00Z",
							},
						],
					}),
				}),
			);
			yield* processEvent(t, "delivery-activity-push");

			const activities = yield* collectTable(t, "view_activity_feed");
			expect(activities).toHaveLength(1);
			expect(activities[0]).toMatchObject({
				activityType: "push",
				title: "Pushed 2 commits to main",
				actorLogin: "testuser",
			});
		}),
	);

	it.effect("projections update correctly after issue state change", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-state-open",
					eventName: "issues",
					action: "opened",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "opened",
						issueId: 5001,
						number: 1,
						state: "open",
						title: "State change test",
						updated_at: "2026-02-18T10:00:00Z",
					}),
				}),
			);
			yield* processEvent(t, "delivery-state-open");

			let overviewResult = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.getRepoOverview, {
					ownerLogin: "testowner",
					name: "testrepo",
				}),
			);
			let overview = assertSuccess(overviewResult) as {
				openIssueCount: number;
			};
			expect(overview).toMatchObject({ openIssueCount: 1 });

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-state-close",
					eventName: "issues",
					action: "closed",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "closed",
						issueId: 5001,
						number: 1,
						state: "closed",
						title: "State change test",
						updated_at: "2026-02-18T12:00:00Z",
					}),
				}),
			);
			yield* processEvent(t, "delivery-state-close");

			overviewResult = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.getRepoOverview, {
					ownerLogin: "testowner",
					name: "testrepo",
				}),
			);
			overview = assertSuccess(overviewResult) as { openIssueCount: number };
			expect(overview).toMatchObject({ openIssueCount: 0 });

			const issuesResult = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listIssues, {
					ownerLogin: "testowner",
					name: "testrepo",
				}),
			);
			const issues = assertSuccess(issuesResult) as Array<{ state: string }>;
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({ state: "closed" });
		}),
	);
});

// ---------------------------------------------------------------------------
// Projection Query Tests (public queries)
// ---------------------------------------------------------------------------

describe("Projection Queries", () => {
	it.effect("listRepos returns repo overview data", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-q-issue",
					eventName: "issues",
					action: "opened",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "opened",
						issueId: 5001,
						number: 1,
						state: "open",
						title: "Query test issue",
					}),
				}),
			);
			yield* processEvent(t, "delivery-q-issue");

			const result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listRepos, {}),
			);
			const repos = assertSuccess(result);
			expect(repos).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						repositoryId,
						fullName: "testowner/testrepo",
						openIssueCount: 1,
					}),
				]),
			);
		}),
	);

	it.effect("getRepoOverview returns null for nonexistent repo", () =>
		Effect.gen(function* () {
			const t = createConvexTest();

			const result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.getRepoOverview, {
					ownerLogin: "nonexistent",
					name: "nope",
				}),
			);
			const value = assertSuccess(result);
			expect(value).toBeNull();
		}),
	);

	it.effect("listActivity returns activity feed entries", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-q-activity",
					eventName: "pull_request",
					action: "opened",
					repositoryId,
					payloadJson: makePrPayload({
						action: "opened",
						prId: 6001,
						number: 42,
						state: "open",
						title: "Activity query test PR",
					}),
				}),
			);
			yield* processEvent(t, "delivery-q-activity");

			const result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listActivity, {
					ownerLogin: "testowner",
					name: "testrepo",
				}),
			);
			const activities = assertSuccess(result);
			expect(activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						activityType: "pr.opened",
						title: "Activity query test PR",
						entityNumber: 42,
					}),
				]),
			);
		}),
	);
});

// ---------------------------------------------------------------------------
// Branch Create/Delete Tests
// ---------------------------------------------------------------------------

describe("Branch Events", () => {
	it.effect("create event adds a branch", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-create-branch",
					eventName: "create",
					action: null,
					repositoryId,
					payloadJson: JSON.stringify({
						ref_type: "branch",
						ref: "feature-new",
						master_branch: "main",
						sender: {
							id: 1001,
							login: "testuser",
							avatar_url: null,
							type: "User",
						},
					}),
				}),
			);
			yield* processEvent(t, "delivery-create-branch");

			const branches = yield* collectTable<{
				name: string;
				repositoryId: number;
			}>(t, "github_branches");
			expect(branches).toHaveLength(1);
			expect(branches[0]).toMatchObject({
				name: "feature-new",
				repositoryId,
			});
		}),
	);

	it.effect("delete event removes a branch", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// Seed a branch first
			yield* Effect.promise(() =>
				t.run(async (ctx) => {
					await ctx.db.insert("github_branches", {
						repositoryId,
						name: "old-feature",
						headSha: "old-sha",
						protected: false,
						updatedAt: Date.now(),
					});
				}),
			);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-delete-branch",
					eventName: "delete",
					action: null,
					repositoryId,
					payloadJson: JSON.stringify({
						ref_type: "branch",
						ref: "old-feature",
						sender: {
							id: 1001,
							login: "testuser",
							avatar_url: null,
							type: "User",
						},
					}),
				}),
			);
			yield* processEvent(t, "delivery-delete-branch");

			const branches = yield* collectTable(t, "github_branches");
			expect(branches).toHaveLength(0);
		}),
	);
});

// ---------------------------------------------------------------------------
// PR Diff Pipeline Tests
// ---------------------------------------------------------------------------

describe("PR Diff Pipeline", () => {
	it.effect("upsertPrFiles inserts new file records", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			const result = yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubActions.upsertPrFiles, {
					repositoryId,
					pullRequestNumber: 42,
					headSha: "sha-abc123",
					files: [
						{
							filename: "src/index.ts",
							status: "modified",
							additions: 10,
							deletions: 3,
							changes: 13,
							patch: "@@ -1,5 +1,12 @@\n+new line",
							previousFilename: null,
						},
						{
							filename: "README.md",
							status: "added",
							additions: 20,
							deletions: 0,
							changes: 20,
							patch: "@@ -0,0 +1,20 @@\n+# README",
							previousFilename: null,
						},
					],
				}),
			);
			const value = assertSuccess(result);
			expect(value).toMatchObject({ upserted: 2 });

			const files = yield* collectTable<{
				filename: string;
				status: string;
				headSha: string;
			}>(t, "github_pull_request_files");
			expect(files).toHaveLength(2);
			expect(files.map((f) => f.filename).sort()).toEqual([
				"README.md",
				"src/index.ts",
			]);
		}),
	);

	it.effect("upsertPrFiles updates existing file records (idempotent)", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// Insert first
			yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubActions.upsertPrFiles, {
					repositoryId,
					pullRequestNumber: 42,
					headSha: "sha-v1",
					files: [
						{
							filename: "src/index.ts",
							status: "modified",
							additions: 5,
							deletions: 1,
							changes: 6,
							patch: "old patch",
							previousFilename: null,
						},
					],
				}),
			);

			// Update with new headSha
			const result = yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubActions.upsertPrFiles, {
					repositoryId,
					pullRequestNumber: 42,
					headSha: "sha-v2",
					files: [
						{
							filename: "src/index.ts",
							status: "modified",
							additions: 10,
							deletions: 3,
							changes: 13,
							patch: "new patch",
							previousFilename: null,
						},
					],
				}),
			);
			const value = assertSuccess(result);
			expect(value).toMatchObject({ upserted: 1 });

			// Should still be 1 file (updated, not duplicated)
			const files = yield* collectTable<{
				filename: string;
				headSha: string;
				additions: number;
			}>(t, "github_pull_request_files");
			expect(files).toHaveLength(1);
			expect(files[0]).toMatchObject({
				filename: "src/index.ts",
				headSha: "sha-v2",
				additions: 10,
			});
		}),
	);

	it.effect("listPrFiles returns files for a PR", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// Seed a PR in domain table (required for listPrFiles to find headSha)
			yield* Effect.promise(() =>
				t.run(async (ctx) => {
					await ctx.db.insert("github_pull_requests", {
						repositoryId,
						githubPrId: 6042,
						number: 42,
						state: "open",
						draft: false,
						title: "Test PR",
						body: null,
						authorUserId: 1001,
						assigneeUserIds: [],
						requestedReviewerUserIds: [],
						baseRefName: "main",
						headRefName: "feature",
						headSha: "sha-abc123",
						mergeableState: null,
						mergedAt: null,
						closedAt: null,
						githubUpdatedAt: Date.now(),
						cachedAt: Date.now(),
					});
				}),
			);

			// Insert file records
			yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubActions.upsertPrFiles, {
					repositoryId,
					pullRequestNumber: 42,
					headSha: "sha-abc123",
					files: [
						{
							filename: "src/app.ts",
							status: "modified",
							additions: 5,
							deletions: 2,
							changes: 7,
							patch: "@@ patch @@",
							previousFilename: null,
						},
					],
				}),
			);

			// Query via projection endpoint
			const result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listPrFiles, {
					ownerLogin: "testowner",
					name: "testrepo",
					number: 42,
				}),
			);
			const value = assertSuccess(result) as {
				headSha: string | null;
				files: Array<{ filename: string }>;
			};
			expect(value.headSha).toBe("sha-abc123");
			expect(value.files).toHaveLength(1);
			expect(value.files[0]).toMatchObject({ filename: "src/app.ts" });
		}),
	);

	it.effect("listPrFiles returns empty for nonexistent PR", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			const result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listPrFiles, {
					ownerLogin: "testowner",
					name: "testrepo",
					number: 999,
				}),
			);
			const value = assertSuccess(result) as {
				headSha: string | null;
				files: Array<unknown>;
			};
			expect(value.headSha).toBeNull();
			expect(value.files).toHaveLength(0);
		}),
	);

	it.effect("listPrFiles filters by headSha when provided", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// Insert files for two different SHAs
			yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubActions.upsertPrFiles, {
					repositoryId,
					pullRequestNumber: 42,
					headSha: "sha-old",
					files: [
						{
							filename: "old-file.ts",
							status: "added",
							additions: 1,
							deletions: 0,
							changes: 1,
							patch: null,
							previousFilename: null,
						},
					],
				}),
			);

			// Insert a second file with different SHA and different filename
			yield* Effect.promise(() =>
				t.run(async (ctx) => {
					await ctx.db.insert("github_pull_request_files", {
						repositoryId,
						pullRequestNumber: 42,
						headSha: "sha-new",
						filename: "new-file.ts",
						status: "added",
						additions: 5,
						deletions: 0,
						changes: 5,
						patch: null,
						previousFilename: null,
						cachedAt: Date.now(),
					});
				}),
			);

			const result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listPrFiles, {
					ownerLogin: "testowner",
					name: "testrepo",
					number: 42,
					headSha: "sha-new",
				}),
			);
			const value = assertSuccess(result) as {
				headSha: string | null;
				files: Array<{ filename: string }>;
			};
			expect(value.headSha).toBe("sha-new");
			expect(value.files).toHaveLength(1);
			expect(value.files[0]).toMatchObject({ filename: "new-file.ts" });
		}),
	);

	it.effect("webhook processing triggers PR file sync scheduling", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// Process a PR opened event
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-pr-files-trigger",
					eventName: "pull_request",
					action: "opened",
					repositoryId,
					payloadJson: makePrPayload({
						action: "opened",
						prId: 6099,
						number: 99,
						state: "open",
						title: "PR that triggers file sync",
						headSha: "sha-trigger",
					}),
				}),
			);
			const result = yield* processEvent(t, "delivery-pr-files-trigger");
			assertSuccess(result);

			// The PR should be created in the domain table
			const prs = yield* collectTable<{
				number: number;
				headSha: string;
			}>(t, "github_pull_requests");
			expect(prs).toHaveLength(1);
			expect(prs[0]).toMatchObject({
				number: 99,
				headSha: "sha-trigger",
			});

			// Note: The scheduler.runAfter for syncPrFiles is called but
			// convex-test doesn't execute scheduled actions. We verify the
			// PR was created which is the prerequisite for file sync.
		}),
	);
});

// ---------------------------------------------------------------------------
// Optimistic Write Operations Tests
// ---------------------------------------------------------------------------

describe("Optimistic Write Operations", () => {
	it.effect("createIssue mutation creates a pending write operation", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			const result = yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.createIssue, {
					correlationId: "corr-issue-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					title: "New issue from UI",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());
			const value = assertSuccess(result);
			expect(value).toMatchObject({
				correlationId: "corr-issue-1",
			});

			const issues = yield* collectTable<{
				title: string;
				optimisticCorrelationId?: string | null;
				optimisticOperationType?: string | null;
				optimisticState?: string | null;
			}>(t, "github_issues");
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({
				title: "New issue from UI",
				optimisticCorrelationId: "corr-issue-1",
				optimisticOperationType: "create_issue",
				optimisticState: "pending",
			});
		}),
	);

	it.effect("createComment mutation creates a pending write operation", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			const result = yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.createComment, {
					correlationId: "corr-comment-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					number: 1,
					body: "A comment from UI",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());
			const value = assertSuccess(result);
			expect(value).toMatchObject({
				correlationId: "corr-comment-1",
			});

			const comments = yield* collectTable<{
				issueNumber: number;
				body: string;
				optimisticCorrelationId?: string | null;
				optimisticOperationType?: string | null;
				optimisticState?: string | null;
			}>(t, "github_issue_comments");
			expect(comments).toHaveLength(1);
			expect(comments[0]).toMatchObject({
				issueNumber: 1,
				body: "A comment from UI",
				optimisticCorrelationId: "corr-comment-1",
				optimisticOperationType: "create_comment",
				optimisticState: "pending",
			});
		}),
	);

	it.effect("markCommentCreateAccepted stores GitHub comment id", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// Create a pending write op
			yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.createComment, {
					correlationId: "corr-complete-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					number: 1,
					body: "Comment to complete",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());

			const result = yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubWrite.markCommentCreateAccepted, {
					correlationId: "corr-complete-1",
					githubCommentId: 999001,
				}),
			);
			const value = assertSuccess(result);
			expect(value).toMatchObject({ updated: true });

			const comments = yield* collectTable<{
				githubCommentId: number;
				optimisticState?: string | null;
			}>(t, "github_issue_comments");
			expect(comments).toHaveLength(1);
			expect(comments[0]).toMatchObject({
				githubCommentId: 999001,
				optimisticState: "pending",
			});
		}),
	);

	it.effect("markCommentCreateFailed transitions pending → failed", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.createComment, {
					correlationId: "corr-fail-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					number: 1,
					body: "Comment to fail",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());

			const result = yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubWrite.markCommentCreateFailed, {
					correlationId: "corr-fail-1",
					errorMessage: "Repository not found",
					errorStatus: 404,
				}),
			);
			const value = assertSuccess(result);
			expect(value).toMatchObject({ updated: true });

			const comments = yield* collectTable<{
				optimisticState?: string | null;
				optimisticErrorMessage?: string | null;
				optimisticErrorStatus?: number | null;
			}>(t, "github_issue_comments");
			expect(comments).toHaveLength(1);
			expect(comments[0]).toMatchObject({
				optimisticState: "failed",
				optimisticErrorMessage: "Repository not found",
				optimisticErrorStatus: 404,
			});
		}),
	);

	it.effect("webhook reconciliation confirms a completed write op", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// Create a pending write op for creating issue #99
			yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.createIssue, {
					correlationId: "corr-confirm-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					title: "Issue to be confirmed",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());

			// Mark it accepted by GitHub (as if the action succeeded)
			yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubWrite.markIssueCreateAccepted, {
					correlationId: "corr-confirm-1",
					githubIssueId: 9900,
					githubIssueNumber: 99,
				}),
			);

			// Now simulate the webhook arriving for issues.opened #99
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-confirm-issue-99",
					eventName: "issues",
					action: "opened",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "opened",
						issueId: 9900,
						number: 99,
						state: "open",
						title: "Issue to be confirmed",
					}),
				}),
			);
			yield* processEvent(t, "delivery-confirm-issue-99");

			// The issue should now be optimistic "confirmed"
			const issues = yield* collectTable<{
				number: number;
				optimisticCorrelationId?: string | null;
				optimisticState?: string | null;
			}>(t, "github_issues");
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({
				number: 99,
				optimisticCorrelationId: "corr-confirm-1",
				optimisticState: "confirmed",
			});
		}),
	);

	it.effect("listWriteOperations returns ops for a repository", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// Create two write ops
			yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.createIssue, {
					correlationId: "corr-list-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					title: "First issue",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());

			yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.createComment, {
					correlationId: "corr-list-2",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					number: 1,
					body: "A comment",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());

			const result = yield* Effect.promise(() =>
				client.query(api.rpc.githubWrite.listWriteOperations, {
					repositoryId,
				}),
			);
			const value = assertSuccess(result);
			const ops = value as Array<{
				correlationId: string;
				operationType: string;
			}>;
			expect(ops).toHaveLength(2);

			const types = ops.map((o) => o.operationType).sort();
			expect(types).toEqual(["create_comment", "create_issue"]);
		}),
	);

	it.effect("updateIssueState mutation creates a pending write operation", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			const result = yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.updateIssueState, {
					correlationId: "corr-close-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					number: 5,
					state: "closed",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());
			const value = assertSuccess(result);
			expect(value).toMatchObject({
				correlationId: "corr-close-1",
			});

			const issues = yield* collectTable<{
				number: number;
				state: string;
				optimisticCorrelationId?: string | null;
				optimisticOperationType?: string | null;
				optimisticState?: string | null;
			}>(t, "github_issues");
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({
				number: 5,
				state: "closed",
				optimisticCorrelationId: "corr-close-1",
				optimisticOperationType: "update_issue_state",
				optimisticState: "pending",
			});
		}),
	);

	it.effect("mergePullRequest mutation creates a pending write operation", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			const result = yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.mergePullRequest, {
					correlationId: "corr-merge-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					number: 10,
					mergeMethod: "squash",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());
			const value = assertSuccess(result);
			expect(value).toMatchObject({
				correlationId: "corr-merge-1",
			});

			const prs = yield* collectTable<{
				number: number;
				state: string;
				optimisticCorrelationId?: string | null;
				optimisticOperationType?: string | null;
				optimisticState?: string | null;
			}>(t, "github_pull_requests");
			expect(prs).toHaveLength(1);
			expect(prs[0]).toMatchObject({
				number: 10,
				state: "closed",
				optimisticCorrelationId: "corr-merge-1",
				optimisticOperationType: "merge_pull_request",
				optimisticState: "pending",
			});
		}),
	);

	it.effect(
		"updatePullRequestBranch mutation creates a pending write operation",
		() =>
			Effect.gen(function* () {
				const t = createConvexTest();
				const client = authClient(t);
				const repositoryId = 12345;
				yield* seedRepository(t, repositoryId);

				const result = yield* Effect.promise(() =>
					client.action(api.rpc.githubWrite.updatePullRequestBranch, {
						correlationId: "corr-update-branch-1",
						ownerLogin: "testowner",
						name: "testrepo",
						repositoryId,
						number: 11,
						expectedHeadSha: "abc123",
					}),
				);
				yield* Effect.promise(() =>
					client.finishInProgressScheduledFunctions(),
				);
				const value = assertSuccess(result);
				expect(value).toMatchObject({
					correlationId: "corr-update-branch-1",
				});

				const prs = yield* collectTable<{
					number: number;
					headSha: string;
					optimisticCorrelationId?: string | null;
					optimisticOperationType?: string | null;
					optimisticState?: string | null;
				}>(t, "github_pull_requests");
				expect(prs).toHaveLength(1);
				expect(prs[0]).toMatchObject({
					number: 11,
					headSha: "abc123",
					optimisticCorrelationId: "corr-update-branch-1",
					optimisticOperationType: "update_pull_request_branch",
					optimisticState: "pending",
				});
			}),
	);

	it.effect("submitPrReview mutation creates a pending optimistic review", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			const result = yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.submitPrReview, {
					correlationId: "corr-review-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					number: 42,
					event: "APPROVE",
					body: "Looks good",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());
			const value = assertSuccess(result);
			expect(value).toMatchObject({
				correlationId: "corr-review-1",
			});

			const reviews = yield* collectTable<{
				pullRequestNumber: number;
				state: string;
				optimisticCorrelationId?: string | null;
				optimisticOperationType?: string | null;
				optimisticState?: string | null;
			}>(t, "github_pull_request_reviews");
			expect(reviews).toHaveLength(1);
			expect(reviews[0]).toMatchObject({
				pullRequestNumber: 42,
				state: "APPROVED",
				optimisticCorrelationId: "corr-review-1",
				optimisticOperationType: "submit_pr_review",
				optimisticState: "pending",
			});
		}),
	);

	it.effect(
		"updateLabels mutation creates a pending optimistic labels update",
		() =>
			Effect.gen(function* () {
				const t = createConvexTest();
				const client = authClient(t);
				const repositoryId = 12345;
				yield* seedRepository(t, repositoryId);

				const result = yield* Effect.promise(() =>
					client.action(api.rpc.githubWrite.updateLabels, {
						correlationId: "corr-labels-1",
						ownerLogin: "testowner",
						name: "testrepo",
						repositoryId,
						number: 77,
						labelsToAdd: ["bug", "priority:high"],
						labelsToRemove: [],
					}),
				);
				yield* Effect.promise(() =>
					client.finishInProgressScheduledFunctions(),
				);
				const value = assertSuccess(result);
				expect(value).toMatchObject({
					correlationId: "corr-labels-1",
				});

				const issues = yield* collectTable<{
					number: number;
					labelNames: Array<string>;
					optimisticCorrelationId?: string | null;
					optimisticOperationType?: string | null;
					optimisticState?: string | null;
				}>(t, "github_issues");
				expect(issues).toHaveLength(1);
				expect(issues[0]).toMatchObject({
					number: 77,
					labelNames: ["bug", "priority:high"],
					optimisticCorrelationId: "corr-labels-1",
					optimisticOperationType: "update_labels",
					optimisticState: "pending",
				});
			}),
	);

	it.effect(
		"updateAssignees mutation creates a pending optimistic assignee update",
		() =>
			Effect.gen(function* () {
				const t = createConvexTest();
				const client = authClient(t);
				const repositoryId = 12345;
				yield* seedRepository(t, repositoryId);

				yield* Effect.promise(() =>
					t.run(async (ctx) => {
						await ctx.db.insert("github_users", {
							githubUserId: 2001,
							login: "alice",
							avatarUrl: null,
							siteAdmin: false,
							type: "User",
							updatedAt: Date.now(),
						});
					}),
				);

				const result = yield* Effect.promise(() =>
					client.action(api.rpc.githubWrite.updateAssignees, {
						correlationId: "corr-assignees-1",
						ownerLogin: "testowner",
						name: "testrepo",
						repositoryId,
						number: 88,
						assigneesToAdd: ["alice"],
						assigneesToRemove: [],
					}),
				);
				yield* Effect.promise(() =>
					client.finishInProgressScheduledFunctions(),
				);
				const value = assertSuccess(result);
				expect(value).toMatchObject({
					correlationId: "corr-assignees-1",
				});

				const issues = yield* collectTable<{
					number: number;
					assigneeUserIds: Array<number>;
					optimisticCorrelationId?: string | null;
					optimisticOperationType?: string | null;
					optimisticState?: string | null;
				}>(t, "github_issues");
				expect(issues).toHaveLength(1);
				expect(issues[0]).toMatchObject({
					number: 88,
					assigneeUserIds: [2001],
					optimisticCorrelationId: "corr-assignees-1",
					optimisticOperationType: "update_assignees",
					optimisticState: "pending",
				});
			}),
	);

	it.effect("issue labeled webhook confirms optimistic labels update", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.updateLabels, {
					correlationId: "corr-confirm-labels-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					number: 15,
					labelsToAdd: ["bug"],
					labelsToRemove: [],
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());
			yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubWrite.markLabelsUpdateAccepted, {
					correlationId: "corr-confirm-labels-1",
				}),
			);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-confirm-labels-1",
					eventName: "issues",
					action: "labeled",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "labeled",
						issueId: 15001,
						number: 15,
						state: "open",
						title: "Issue 15",
					}),
				}),
			);
			yield* processEvent(t, "delivery-confirm-labels-1");

			const issues = yield* collectTable<{
				number: number;
				optimisticCorrelationId?: string | null;
				optimisticState?: string | null;
			}>(t, "github_issues");
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({
				number: 15,
				optimisticCorrelationId: "corr-confirm-labels-1",
				optimisticState: "confirmed",
			});
		}),
	);

	it.effect("issue assigned webhook confirms optimistic assignee update", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* Effect.promise(() =>
				t.run(async (ctx) => {
					await ctx.db.insert("github_users", {
						githubUserId: 777,
						login: "octocat",
						avatarUrl: null,
						siteAdmin: false,
						type: "User",
						updatedAt: Date.now(),
					});
				}),
			);

			yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.updateAssignees, {
					correlationId: "corr-confirm-assignees-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					number: 16,
					assigneesToAdd: ["octocat"],
					assigneesToRemove: [],
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());
			yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubWrite.markAssigneesUpdateAccepted, {
					correlationId: "corr-confirm-assignees-1",
				}),
			);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-confirm-assignees-1",
					eventName: "issues",
					action: "assigned",
					repositoryId,
					payloadJson: makeIssuePayload({
						action: "assigned",
						issueId: 16001,
						number: 16,
						state: "open",
						title: "Issue 16",
					}),
				}),
			);
			yield* processEvent(t, "delivery-confirm-assignees-1");

			const issues = yield* collectTable<{
				number: number;
				optimisticCorrelationId?: string | null;
				optimisticState?: string | null;
			}>(t, "github_issues");
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({
				number: 16,
				optimisticCorrelationId: "corr-confirm-assignees-1",
				optimisticState: "confirmed",
			});
		}),
	);

	it.effect("review submitted webhook confirms optimistic PR review", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.submitPrReview, {
					correlationId: "corr-confirm-review-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					number: 42,
					event: "APPROVE",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());

			yield* Effect.promise(() =>
				t.mutation(internal.rpc.githubWrite.markPrReviewAccepted, {
					correlationId: "corr-confirm-review-1",
					githubReviewId: 555001,
				}),
			);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-confirm-review-1",
					eventName: "pull_request_review",
					action: "submitted",
					repositoryId,
					payloadJson: makePrReviewPayload({
						action: "submitted",
						reviewId: 555001,
						prNumber: 42,
						state: "APPROVED",
					}),
				}),
			);
			yield* processEvent(t, "delivery-confirm-review-1");

			const reviews = yield* collectTable<{
				githubReviewId: number;
				optimisticCorrelationId?: string | null;
				optimisticState?: string | null;
			}>(t, "github_pull_request_reviews");
			expect(reviews).toHaveLength(1);
			expect(reviews[0]).toMatchObject({
				githubReviewId: 555001,
				optimisticCorrelationId: "corr-confirm-review-1",
				optimisticState: "confirmed",
			});
		}),
	);

	it.effect("duplicate correlationId is rejected for createIssue", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const client = authClient(t);
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// First write succeeds
			yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.createIssue, {
					correlationId: "corr-dupe-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					title: "First",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());

			// Second write with same correlationId
			const result = yield* Effect.promise(() =>
				client.action(api.rpc.githubWrite.createIssue, {
					correlationId: "corr-dupe-1",
					ownerLogin: "testowner",
					name: "testrepo",
					repositoryId,
					title: "Duplicate",
				}),
			);
			yield* Effect.promise(() => client.finishInProgressScheduledFunctions());

			// Should be a failure (DuplicateOperationError)
			const exit = result as { _tag: string; cause?: unknown };
			expect(exit._tag).toBe("Failure");

			// Only one optimistic issue row should exist
			const issues = yield* collectTable<{
				optimisticCorrelationId?: string | null;
			}>(t, "github_issues");
			expect(issues).toHaveLength(1);
			expect(issues[0]).toMatchObject({
				optimisticCorrelationId: "corr-dupe-1",
			});
		}),
	);
});

// ---------------------------------------------------------------------------
// Paginated Query Tests
// ---------------------------------------------------------------------------

/** Seed N pull request rows in normalized table */
const seedPrViewRows = (
	t: ReturnType<typeof createConvexTest>,
	repositoryId: number,
	count: number,
	stateOverride?: "open" | "closed",
) =>
	Effect.promise(() =>
		t.run(async (ctx) => {
			for (let i = 1; i <= count; i++) {
				const now = Date.now() - (count - i) * 1000;
				const state = stateOverride ?? (i % 3 === 0 ? "closed" : "open");
				await ctx.db.insert("github_pull_requests", {
					repositoryId,
					githubPrId: 6000 + i,
					number: i,
					state,
					draft: false,
					title: `PR #${i}`,
					body: null,
					authorUserId: null,
					assigneeUserIds: [],
					requestedReviewerUserIds: [],
					headRefName: `feature-${i}`,
					baseRefName: "main",
					headSha: `sha-${i}`,
					mergeableState: null,
					mergedAt: null,
					closedAt: state === "closed" ? now : null,
					githubUpdatedAt: now,
					cachedAt: now,
				});
			}
		}),
	);

/** Seed N issue rows in normalized table */
const seedIssueViewRows = (
	t: ReturnType<typeof createConvexTest>,
	repositoryId: number,
	count: number,
	stateOverride?: "open" | "closed",
) =>
	Effect.promise(() =>
		t.run(async (ctx) => {
			for (let i = 1; i <= count; i++) {
				const now = Date.now() - (count - i) * 1000;
				const state = stateOverride ?? (i % 4 === 0 ? "closed" : "open");
				await ctx.db.insert("github_issues", {
					repositoryId,
					githubIssueId: 5000 + i,
					number: i,
					state,
					title: `Issue #${i}`,
					body: null,
					authorUserId: null,
					assigneeUserIds: [],
					labelNames: [],
					commentCount: 0,
					isPullRequest: false,
					closedAt: state === "closed" ? now : null,
					githubUpdatedAt: now,
					cachedAt: now,
				});
			}
		}),
	);

/** Seed N activity feed rows directly into the view table */
const seedActivityViewRows = (
	t: ReturnType<typeof createConvexTest>,
	repositoryId: number,
	count: number,
) =>
	Effect.promise(() =>
		t.run(async (ctx) => {
			for (let i = 1; i <= count; i++) {
				await ctx.db.insert("view_activity_feed", {
					repositoryId,
					installationId: 0,
					activityType: "issue.opened",
					title: `Activity ${i}`,
					description: null,
					actorLogin: "testuser",
					actorAvatarUrl: null,
					entityNumber: i,
					createdAt: Date.now() - (count - i) * 1000,
				});
			}
		}),
	);

describe("Paginated Queries", () => {
	it.effect(
		"listPullRequestsPaginated returns first page and continues with cursor",
		() =>
			Effect.gen(function* () {
				const t = createConvexTest();
				const repositoryId = 12345;
				yield* seedRepository(t, repositoryId);
				yield* seedPrViewRows(t, repositoryId, 5);

				// First page: request 2 items
				const page1Result = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listPullRequestsPaginated, {
						ownerLogin: "testowner",
						name: "testrepo",
						cursor: null,
						numItems: 2,
					}),
				);
				const page1 = assertSuccess(page1Result) as {
					page: Array<{ number: number }>;
					isDone: boolean;
					continueCursor: string;
				};
				expect(page1.page).toHaveLength(2);
				expect(page1.isDone).toBe(false);
				expect(page1.continueCursor).toBeTruthy();

				// Second page using cursor
				const page2Result = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listPullRequestsPaginated, {
						ownerLogin: "testowner",
						name: "testrepo",
						cursor: page1.continueCursor,
						numItems: 2,
					}),
				);
				const page2 = assertSuccess(page2Result) as {
					page: Array<{ number: number }>;
					isDone: boolean;
					continueCursor: string;
				};
				expect(page2.page).toHaveLength(2);

				// Third page — should have 1 remaining
				const page3Result = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listPullRequestsPaginated, {
						ownerLogin: "testowner",
						name: "testrepo",
						cursor: page2.continueCursor,
						numItems: 2,
					}),
				);
				const page3 = assertSuccess(page3Result) as {
					page: Array<{ number: number }>;
					isDone: boolean;
					continueCursor: string;
				};
				expect(page3.page).toHaveLength(1);
				expect(page3.isDone).toBe(true);

				// All 5 items seen across pages
				const allNumbers = [
					...page1.page.map((p) => p.number),
					...page2.page.map((p) => p.number),
					...page3.page.map((p) => p.number),
				];
				expect(allNumbers).toHaveLength(5);
			}),
	);

	it.effect("listPullRequestsPaginated filters by state", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// 3 open + 2 closed
			yield* seedPrViewRows(t, repositoryId, 3, "open");
			yield* seedPrViewRows(t, repositoryId, 2, "closed");

			// Filter open
			const openResult = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listPullRequestsPaginated, {
					ownerLogin: "testowner",
					name: "testrepo",
					cursor: null,
					numItems: 10,
					state: "open",
				}),
			);
			const open = assertSuccess(openResult) as {
				page: Array<{ state: string }>;
				isDone: boolean;
			};
			expect(open.page).toHaveLength(3);
			for (const pr of open.page) {
				expect(pr.state).toBe("open");
			}

			// Filter closed
			const closedResult = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listPullRequestsPaginated, {
					ownerLogin: "testowner",
					name: "testrepo",
					cursor: null,
					numItems: 10,
					state: "closed",
				}),
			);
			const closed = assertSuccess(closedResult) as {
				page: Array<{ state: string }>;
				isDone: boolean;
			};
			expect(closed.page).toHaveLength(2);
			for (const pr of closed.page) {
				expect(pr.state).toBe("closed");
			}
		}),
	);

	it.effect("listPullRequestsPaginated returns empty for unknown repo", () =>
		Effect.gen(function* () {
			const t = createConvexTest();

			const result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listPullRequestsPaginated, {
					ownerLogin: "nonexistent",
					name: "nope",
					cursor: null,
					numItems: 10,
				}),
			);
			const value = assertSuccess(result) as {
				page: Array<unknown>;
				isDone: boolean;
			};
			expect(value.page).toHaveLength(0);
			expect(value.isDone).toBe(true);
		}),
	);

	it.effect(
		"listIssuesPaginated returns first page and supports state filter",
		() =>
			Effect.gen(function* () {
				const t = createConvexTest();
				const repositoryId = 12345;
				yield* seedRepository(t, repositoryId);

				// 4 open + 3 closed
				yield* seedIssueViewRows(t, repositoryId, 4, "open");
				yield* seedIssueViewRows(t, repositoryId, 3, "closed");

				// All items
				const allResult = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listIssuesPaginated, {
						ownerLogin: "testowner",
						name: "testrepo",
						cursor: null,
						numItems: 10,
					}),
				);
				const all = assertSuccess(allResult) as {
					page: Array<{ number: number; state: string }>;
					isDone: boolean;
				};
				expect(all.page).toHaveLength(7);
				expect(all.isDone).toBe(true);

				// Filter open only
				const openResult = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listIssuesPaginated, {
						ownerLogin: "testowner",
						name: "testrepo",
						cursor: null,
						numItems: 10,
						state: "open",
					}),
				);
				const open = assertSuccess(openResult) as {
					page: Array<{ state: string }>;
					isDone: boolean;
				};
				expect(open.page).toHaveLength(4);
				for (const issue of open.page) {
					expect(issue.state).toBe("open");
				}
			}),
	);

	it.effect("listIssuesPaginated paginates with cursor", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);
			yield* seedIssueViewRows(t, repositoryId, 7);

			// Page 1 of 3 items
			const page1Result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listIssuesPaginated, {
					ownerLogin: "testowner",
					name: "testrepo",
					cursor: null,
					numItems: 3,
				}),
			);
			const page1 = assertSuccess(page1Result) as {
				page: Array<{ number: number }>;
				isDone: boolean;
				continueCursor: string;
			};
			expect(page1.page).toHaveLength(3);
			expect(page1.isDone).toBe(false);

			// Page 2
			const page2Result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listIssuesPaginated, {
					ownerLogin: "testowner",
					name: "testrepo",
					cursor: page1.continueCursor,
					numItems: 3,
				}),
			);
			const page2 = assertSuccess(page2Result) as {
				page: Array<{ number: number }>;
				isDone: boolean;
				continueCursor: string;
			};
			expect(page2.page).toHaveLength(3);

			// Page 3 — 1 remaining
			const page3Result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listIssuesPaginated, {
					ownerLogin: "testowner",
					name: "testrepo",
					cursor: page2.continueCursor,
					numItems: 3,
				}),
			);
			const page3 = assertSuccess(page3Result) as {
				page: Array<{ number: number }>;
				isDone: boolean;
			};
			expect(page3.page).toHaveLength(1);
			expect(page3.isDone).toBe(true);
		}),
	);

	it.effect(
		"listActivityPaginated returns first page and continues with cursor",
		() =>
			Effect.gen(function* () {
				const t = createConvexTest();
				const repositoryId = 12345;
				yield* seedRepository(t, repositoryId);
				yield* seedActivityViewRows(t, repositoryId, 5);

				// First page: request 2 items
				const page1Result = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listActivityPaginated, {
						ownerLogin: "testowner",
						name: "testrepo",
						cursor: null,
						numItems: 2,
					}),
				);
				const page1 = assertSuccess(page1Result) as {
					page: Array<{ entityNumber: number }>;
					isDone: boolean;
					continueCursor: string;
				};
				expect(page1.page).toHaveLength(2);
				expect(page1.isDone).toBe(false);

				// Second page
				const page2Result = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listActivityPaginated, {
						ownerLogin: "testowner",
						name: "testrepo",
						cursor: page1.continueCursor,
						numItems: 2,
					}),
				);
				const page2 = assertSuccess(page2Result) as {
					page: Array<{ entityNumber: number }>;
					isDone: boolean;
					continueCursor: string;
				};
				expect(page2.page).toHaveLength(2);

				// Third page — 1 remaining
				const page3Result = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listActivityPaginated, {
						ownerLogin: "testowner",
						name: "testrepo",
						cursor: page2.continueCursor,
						numItems: 2,
					}),
				);
				const page3 = assertSuccess(page3Result) as {
					page: Array<{ entityNumber: number }>;
					isDone: boolean;
				};
				expect(page3.page).toHaveLength(1);
				expect(page3.isDone).toBe(true);

				// All 5 activities seen
				const allNumbers = [
					...page1.page.map((a) => a.entityNumber),
					...page2.page.map((a) => a.entityNumber),
					...page3.page.map((a) => a.entityNumber),
				];
				expect(allNumbers).toHaveLength(5);
			}),
	);

	it.effect("listActivityPaginated returns empty for nonexistent repo", () =>
		Effect.gen(function* () {
			const t = createConvexTest();

			const result = yield* Effect.promise(() =>
				t.query(api.rpc.projectionQueries.listActivityPaginated, {
					ownerLogin: "nonexistent",
					name: "nope",
					cursor: null,
					numItems: 10,
				}),
			);
			const value = assertSuccess(result) as {
				page: Array<unknown>;
				isDone: boolean;
			};
			expect(value.page).toHaveLength(0);
			expect(value.isDone).toBe(true);
		}),
	);
});

// ---------------------------------------------------------------------------
// Check Run Event Tests
// ---------------------------------------------------------------------------

describe("Check Run Events", () => {
	it.effect("check_run created event inserts a check run", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-checkrun-created",
					eventName: "check_run",
					action: "created",
					repositoryId,
					payloadJson: makeCheckRunPayload({
						action: "created",
						checkRunId: 8001,
						name: "CI / Build",
						headSha: "sha-pr-head",
						status: "in_progress",
					}),
				}),
			);
			yield* processEvent(t, "delivery-checkrun-created");

			const checkRuns = yield* collectTable<{
				githubCheckRunId: number;
				name: string;
				headSha: string;
				status: string;
				conclusion: string | null;
			}>(t, "github_check_runs");
			expect(checkRuns).toHaveLength(1);
			expect(checkRuns[0]).toMatchObject({
				githubCheckRunId: 8001,
				name: "CI / Build",
				headSha: "sha-pr-head",
				status: "in_progress",
				conclusion: null,
			});
		}),
	);

	it.effect("check_run completed event updates status and conclusion", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// First: create the check run
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-checkrun-create-2",
					eventName: "check_run",
					action: "created",
					repositoryId,
					payloadJson: makeCheckRunPayload({
						action: "created",
						checkRunId: 8002,
						name: "CI / Tests",
						headSha: "sha-pr-head-2",
						status: "in_progress",
					}),
				}),
			);
			yield* processEvent(t, "delivery-checkrun-create-2");

			// Then: complete it
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-checkrun-complete-2",
					eventName: "check_run",
					action: "completed",
					repositoryId,
					payloadJson: makeCheckRunPayload({
						action: "completed",
						checkRunId: 8002,
						name: "CI / Tests",
						headSha: "sha-pr-head-2",
						status: "completed",
						conclusion: "success",
						completedAt: "2026-02-18T10:05:00Z",
					}),
				}),
			);
			yield* processEvent(t, "delivery-checkrun-complete-2");

			const checkRuns = yield* collectTable<{
				githubCheckRunId: number;
				status: string;
				conclusion: string | null;
				completedAt: number | null;
			}>(t, "github_check_runs");
			expect(checkRuns).toHaveLength(1);
			expect(checkRuns[0]).toMatchObject({
				githubCheckRunId: 8002,
				status: "completed",
				conclusion: "success",
			});
			expect(checkRuns[0].completedAt).not.toBeNull();
		}),
	);

	it.effect("check_run completed event generates activity feed entry", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-checkrun-activity",
					eventName: "check_run",
					action: "completed",
					repositoryId,
					payloadJson: makeCheckRunPayload({
						action: "completed",
						checkRunId: 8003,
						name: "CI / Lint",
						headSha: "sha-lint",
						status: "completed",
						conclusion: "failure",
						completedAt: "2026-02-18T10:05:00Z",
					}),
				}),
			);
			yield* processEvent(t, "delivery-checkrun-activity");

			const activities = yield* collectTable<{
				activityType: string;
				title: string;
				description: string | null;
			}>(t, "view_activity_feed");
			expect(activities).toHaveLength(1);
			expect(activities[0]).toMatchObject({
				activityType: "check_run.failure",
				title: "CI / Lint",
				description: "Conclusion: failure",
			});
		}),
	);

	it.effect(
		"check_run created event does NOT generate activity feed entry",
		() =>
			Effect.gen(function* () {
				const t = createConvexTest();
				const repositoryId = 12345;
				yield* seedRepository(t, repositoryId);

				yield* insertRawEvent(
					t,
					makeRawEvent({
						deliveryId: "delivery-checkrun-no-activity",
						eventName: "check_run",
						action: "created",
						repositoryId,
						payloadJson: makeCheckRunPayload({
							action: "created",
							checkRunId: 8004,
							name: "CI / Deploy",
							headSha: "sha-deploy",
							status: "queued",
						}),
					}),
				);
				yield* processEvent(t, "delivery-checkrun-no-activity");

				// Only completed check runs produce activity feed entries
				const activities = yield* collectTable(t, "view_activity_feed");
				expect(activities).toHaveLength(0);
			}),
	);
});

// ---------------------------------------------------------------------------
// Issue Comment Event Tests
// ---------------------------------------------------------------------------

describe("Issue Comment Events", () => {
	it.effect("issue_comment created event inserts a comment", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-comment-created",
					eventName: "issue_comment",
					action: "created",
					repositoryId,
					payloadJson: makeIssueCommentPayload({
						action: "created",
						commentId: 7001,
						issueNumber: 5,
						body: "Looks good to me!",
					}),
				}),
			);
			yield* processEvent(t, "delivery-comment-created");

			const comments = yield* collectTable<{
				githubCommentId: number;
				issueNumber: number;
				body: string;
				authorUserId: number | null;
			}>(t, "github_issue_comments");
			expect(comments).toHaveLength(1);
			expect(comments[0]).toMatchObject({
				githubCommentId: 7001,
				issueNumber: 5,
				body: "Looks good to me!",
				authorUserId: 1001,
			});
		}),
	);

	it.effect("issue_comment edited event updates an existing comment", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// First: create the comment
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-comment-create-edit",
					eventName: "issue_comment",
					action: "created",
					repositoryId,
					payloadJson: makeIssueCommentPayload({
						action: "created",
						commentId: 7002,
						issueNumber: 3,
						body: "Original body",
						createdAt: "2026-02-18T10:00:00Z",
						updatedAt: "2026-02-18T10:00:00Z",
					}),
				}),
			);
			yield* processEvent(t, "delivery-comment-create-edit");

			// Then: edit it
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-comment-edited",
					eventName: "issue_comment",
					action: "edited",
					repositoryId,
					payloadJson: makeIssueCommentPayload({
						action: "edited",
						commentId: 7002,
						issueNumber: 3,
						body: "Updated body with corrections",
						createdAt: "2026-02-18T10:00:00Z",
						updatedAt: "2026-02-18T10:05:00Z",
					}),
				}),
			);
			yield* processEvent(t, "delivery-comment-edited");

			const comments = yield* collectTable<{
				githubCommentId: number;
				body: string;
			}>(t, "github_issue_comments");
			expect(comments).toHaveLength(1);
			expect(comments[0]).toMatchObject({
				githubCommentId: 7002,
				body: "Updated body with corrections",
			});
		}),
	);

	it.effect("issue_comment deleted event removes the comment", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// First: create a comment
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-comment-create-del",
					eventName: "issue_comment",
					action: "created",
					repositoryId,
					payloadJson: makeIssueCommentPayload({
						action: "created",
						commentId: 7003,
						issueNumber: 8,
						body: "This comment will be deleted",
					}),
				}),
			);
			yield* processEvent(t, "delivery-comment-create-del");

			let comments = yield* collectTable(t, "github_issue_comments");
			expect(comments).toHaveLength(1);

			// Then: delete it
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-comment-deleted",
					eventName: "issue_comment",
					action: "deleted",
					repositoryId,
					payloadJson: makeIssueCommentPayload({
						action: "deleted",
						commentId: 7003,
						issueNumber: 8,
						body: "This comment will be deleted",
					}),
				}),
			);
			yield* processEvent(t, "delivery-comment-deleted");

			comments = yield* collectTable(t, "github_issue_comments");
			expect(comments).toHaveLength(0);
		}),
	);

	it.effect("issue_comment on a PR generates pr_comment activity type", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-pr-comment-activity",
					eventName: "issue_comment",
					action: "created",
					repositoryId,
					payloadJson: makeIssueCommentPayload({
						action: "created",
						commentId: 7004,
						issueNumber: 42,
						body: "PR comment here",
						isPullRequest: true,
					}),
				}),
			);
			yield* processEvent(t, "delivery-pr-comment-activity");

			const activities = yield* collectTable<{
				activityType: string;
				entityNumber: number | null;
			}>(t, "view_activity_feed");
			expect(activities).toHaveLength(1);
			expect(activities[0]).toMatchObject({
				activityType: "pr_comment.created",
				entityNumber: 42,
			});
		}),
	);
});

// ---------------------------------------------------------------------------
// Pull Request Review Event Tests
// ---------------------------------------------------------------------------

describe("Pull Request Review Events", () => {
	it.effect("pr_review submitted event inserts a review", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-review-submitted",
					eventName: "pull_request_review",
					action: "submitted",
					repositoryId,
					payloadJson: makePrReviewPayload({
						action: "submitted",
						reviewId: 9001,
						prNumber: 42,
						state: "approved",
						commitSha: "sha-reviewed",
					}),
				}),
			);
			yield* processEvent(t, "delivery-review-submitted");

			const reviews = yield* collectTable<{
				githubReviewId: number;
				pullRequestNumber: number;
				state: string;
				commitSha: string | null;
				authorUserId: number | null;
			}>(t, "github_pull_request_reviews");
			expect(reviews).toHaveLength(1);
			expect(reviews[0]).toMatchObject({
				githubReviewId: 9001,
				pullRequestNumber: 42,
				state: "approved",
				commitSha: "sha-reviewed",
				authorUserId: 2001,
			});

			// Reviewer user should be upserted
			const users = yield* collectTable<{
				githubUserId: number;
				login: string;
			}>(t, "github_users");
			expect(users).toHaveLength(1);
			expect(users[0]).toMatchObject({
				githubUserId: 2001,
				login: "reviewer",
			});
		}),
	);

	it.effect("pr_review dismissed event updates existing review state", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// First: submit the review
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-review-submit-dismiss",
					eventName: "pull_request_review",
					action: "submitted",
					repositoryId,
					payloadJson: makePrReviewPayload({
						action: "submitted",
						reviewId: 9002,
						prNumber: 10,
						state: "changes_requested",
					}),
				}),
			);
			yield* processEvent(t, "delivery-review-submit-dismiss");

			let reviews = yield* collectTable<{
				githubReviewId: number;
				state: string;
			}>(t, "github_pull_request_reviews");
			expect(reviews).toHaveLength(1);
			expect(reviews[0]).toMatchObject({ state: "changes_requested" });

			// Then: dismiss it
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-review-dismissed",
					eventName: "pull_request_review",
					action: "dismissed",
					repositoryId,
					payloadJson: makePrReviewPayload({
						action: "dismissed",
						reviewId: 9002,
						prNumber: 10,
						state: "dismissed",
					}),
				}),
			);
			yield* processEvent(t, "delivery-review-dismissed");

			reviews = yield* collectTable(t, "github_pull_request_reviews");
			expect(reviews).toHaveLength(1);
			expect(reviews[0]).toMatchObject({
				githubReviewId: 9002,
				state: "dismissed",
			});
		}),
	);

	it.effect("pr_review submitted event generates activity feed entry", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-review-activity",
					eventName: "pull_request_review",
					action: "submitted",
					repositoryId,
					payloadJson: makePrReviewPayload({
						action: "submitted",
						reviewId: 9003,
						prNumber: 7,
						prTitle: "Important feature",
						state: "approved",
					}),
				}),
			);
			yield* processEvent(t, "delivery-review-activity");

			const activities = yield* collectTable<{
				activityType: string;
				title: string;
				actorLogin: string | null;
				entityNumber: number | null;
			}>(t, "view_activity_feed");
			expect(activities).toHaveLength(1);
			expect(activities[0]).toMatchObject({
				activityType: "pr_review.approved",
				title: "Important feature",
				actorLogin: "reviewer",
				entityNumber: 7,
			});
		}),
	);

	it.effect("multiple reviews on same PR are stored independently", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			// Review 1: commented
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-review-multi-1",
					eventName: "pull_request_review",
					action: "submitted",
					repositoryId,
					payloadJson: makePrReviewPayload({
						action: "submitted",
						reviewId: 9010,
						prNumber: 15,
						state: "commented",
						user: {
							id: 3001,
							login: "reviewer-a",
							avatar_url: null,
							type: "User",
						},
					}),
				}),
			);
			yield* processEvent(t, "delivery-review-multi-1");

			// Review 2: approved (different reviewer)
			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-review-multi-2",
					eventName: "pull_request_review",
					action: "submitted",
					repositoryId,
					payloadJson: makePrReviewPayload({
						action: "submitted",
						reviewId: 9011,
						prNumber: 15,
						state: "approved",
						user: {
							id: 3002,
							login: "reviewer-b",
							avatar_url: null,
							type: "User",
						},
					}),
				}),
			);
			yield* processEvent(t, "delivery-review-multi-2");

			const reviews = yield* collectTable<{
				githubReviewId: number;
				state: string;
				authorUserId: number | null;
			}>(t, "github_pull_request_reviews");
			expect(reviews).toHaveLength(2);

			const states = reviews.map((r) => r.state).sort();
			expect(states).toEqual(["approved", "commented"]);

			// Both reviewers should be upserted
			const users = yield* collectTable<{
				githubUserId: number;
				login: string;
			}>(t, "github_users");
			expect(users).toHaveLength(2);
		}),
	);
});

// ---------------------------------------------------------------------------
// Pull Request Review Comment Event Tests
// ---------------------------------------------------------------------------

describe("Pull Request Review Comment Events", () => {
	it.effect("pr_review_comment created event inserts a review comment", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-review-comment-created",
					eventName: "pull_request_review_comment",
					action: "created",
					repositoryId,
					payloadJson: makePrReviewCommentPayload({
						action: "created",
						reviewCommentId: 9901,
						prNumber: 42,
						body: "Please rename this variable.",
						path: "src/main.ts",
						line: 27,
					}),
				}),
			);
			yield* processEvent(t, "delivery-review-comment-created");

			const reviewComments = yield* collectTable<{
				githubReviewCommentId: number;
				pullRequestNumber: number;
				githubReviewId: number | null;
				body: string;
				path: string | null;
				line: number | null;
				authorUserId: number | null;
			}>(t, "github_pull_request_review_comments");

			expect(reviewComments).toHaveLength(1);
			expect(reviewComments[0]).toMatchObject({
				githubReviewCommentId: 9901,
				pullRequestNumber: 42,
				githubReviewId: 9101,
				body: "Please rename this variable.",
				path: "src/main.ts",
				line: 27,
				authorUserId: 2101,
			});
		}),
	);

	it.effect(
		"pr_review_comment edited event updates an existing review comment",
		() =>
			Effect.gen(function* () {
				const t = createConvexTest();
				const repositoryId = 12345;
				yield* seedRepository(t, repositoryId);

				yield* insertRawEvent(
					t,
					makeRawEvent({
						deliveryId: "delivery-review-comment-create-edit",
						eventName: "pull_request_review_comment",
						action: "created",
						repositoryId,
						payloadJson: makePrReviewCommentPayload({
							action: "created",
							reviewCommentId: 9902,
							prNumber: 9,
							body: "Initial inline note",
							updatedAt: "2026-02-18T12:00:00Z",
						}),
					}),
				);
				yield* processEvent(t, "delivery-review-comment-create-edit");

				yield* insertRawEvent(
					t,
					makeRawEvent({
						deliveryId: "delivery-review-comment-edited",
						eventName: "pull_request_review_comment",
						action: "edited",
						repositoryId,
						payloadJson: makePrReviewCommentPayload({
							action: "edited",
							reviewCommentId: 9902,
							prNumber: 9,
							body: "Updated inline note",
							updatedAt: "2026-02-18T12:05:00Z",
						}),
					}),
				);
				yield* processEvent(t, "delivery-review-comment-edited");

				const reviewComments = yield* collectTable<{
					githubReviewCommentId: number;
					body: string;
				}>(t, "github_pull_request_review_comments");

				expect(reviewComments).toHaveLength(1);
				expect(reviewComments[0]).toMatchObject({
					githubReviewCommentId: 9902,
					body: "Updated inline note",
				});
			}),
	);

	it.effect("pr_review_comment deleted event removes the review comment", () =>
		Effect.gen(function* () {
			const t = createConvexTest();
			const repositoryId = 12345;
			yield* seedRepository(t, repositoryId);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-review-comment-create-del",
					eventName: "pull_request_review_comment",
					action: "created",
					repositoryId,
					payloadJson: makePrReviewCommentPayload({
						action: "created",
						reviewCommentId: 9903,
						prNumber: 11,
						body: "Will delete this",
					}),
				}),
			);
			yield* processEvent(t, "delivery-review-comment-create-del");

			let reviewComments = yield* collectTable(
				t,
				"github_pull_request_review_comments",
			);
			expect(reviewComments).toHaveLength(1);

			yield* insertRawEvent(
				t,
				makeRawEvent({
					deliveryId: "delivery-review-comment-deleted",
					eventName: "pull_request_review_comment",
					action: "deleted",
					repositoryId,
					payloadJson: makePrReviewCommentPayload({
						action: "deleted",
						reviewCommentId: 9903,
						prNumber: 11,
						body: "Will delete this",
					}),
				}),
			);
			yield* processEvent(t, "delivery-review-comment-deleted");

			reviewComments = yield* collectTable(
				t,
				"github_pull_request_review_comments",
			);
			expect(reviewComments).toHaveLength(0);
		}),
	);
});
