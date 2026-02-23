/**
 * Smoke test for onboarding a new repository.
 *
 * Validates the full pipeline from repo connection through webhook processing
 * to projection queries — all via convex-test (no real GitHub API needed).
 *
 * Run: cd packages/database && bunx vitest run --no-watch --pool=forks smokeOnboarding
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { api, internal } from "./convex/_generated/api";
import { createConvexTest } from "./testing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ExitEncoded = { _tag: string; value?: unknown; cause?: unknown };

const assertSuccess = (result: unknown): unknown => {
	const exit = result as ExitEncoded;
	if (exit._tag !== "Success") {
		throw new Error(
			`Expected Success, got ${exit._tag}: ${JSON.stringify(exit.cause)}`,
		);
	}
	return exit.value;
};

const makeRawEvent = (overrides: {
	deliveryId: string;
	eventName: string;
	action?: string;
	repositoryId: number;
	payloadJson: string;
}) => ({
	deliveryId: overrides.deliveryId,
	eventName: overrides.eventName,
	action: overrides.action ?? null,
	installationId: 0,
	repositoryId: overrides.repositoryId,
	signatureValid: true,
	payloadJson: overrides.payloadJson,
	receivedAt: Date.now(),
	processState: "pending" as const,
	processError: null,
	processAttempts: 0,
	nextRetryAt: null,
});

// ---------------------------------------------------------------------------
// Full onboarding smoke test
// ---------------------------------------------------------------------------

describe("Repository Onboarding Smoke Test", () => {
	it.effect(
		"full pipeline: seed repo + process diverse events + verify projections",
		() =>
			Effect.gen(function* () {
				const t = createConvexTest();
				const repositoryId = 99999;
				const ownerLogin = "smoke-org";
				const repoName = "smoke-repo";

				// Step 1: Seed the repository (simulates bootstrap)
				yield* Effect.promise(() =>
					t.run(async (ctx) => {
						await ctx.db.insert("github_installations", {
							installationId: 0,
							accountId: 500,
							accountLogin: ownerLogin,
							accountType: "Organization",
							suspendedAt: null,
							permissionsDigest: "",
							eventsDigest: "",
							updatedAt: Date.now(),
						});
						await ctx.db.insert("github_repositories", {
							githubRepoId: repositoryId,
							installationId: 0,
							ownerId: 500,
							ownerLogin,
							name: repoName,
							fullName: `${ownerLogin}/${repoName}`,
							private: false,
							visibility: "public",
							defaultBranch: "main",
							archived: false,
							disabled: false,
							fork: false,
							pushedAt: null,
							githubUpdatedAt: Date.now(),
							cachedAt: Date.now(),
						});
						await ctx.db.insert("github_branches", {
							repositoryId,
							name: "main",
							headSha: "sha-initial",
							protected: true,
							updatedAt: Date.now(),
						});
					}),
				);

				// Step 2: Process a batch of diverse webhook events

				// 2a: Two issues opened
				for (let i = 1; i <= 2; i++) {
					yield* Effect.promise(() =>
						t.run(async (ctx) => {
							await ctx.db.insert("github_webhook_events_raw", {
								...makeRawEvent({
									deliveryId: `smoke-issue-${i}`,
									eventName: "issues",
									action: "opened",
									repositoryId,
									payloadJson: JSON.stringify({
										action: "opened",
										issue: {
											id: 50000 + i,
											number: i,
											state: "open",
											title: `Smoke issue ${i}`,
											body: `Body for issue ${i}`,
											user: {
												id: 1001,
												login: "dev-alice",
												avatar_url: "https://example.com/alice.png",
												type: "User",
											},
											labels: [{ name: "bug" }],
											assignees: [],
											comments: 0,
											updated_at: `2026-02-18T1${i}:00:00Z`,
										},
										sender: {
											id: 1001,
											login: "dev-alice",
											avatar_url: "https://example.com/alice.png",
											type: "User",
										},
									}),
								}),
							});
						}),
					);
				}

				// 2b: One PR opened
				yield* Effect.promise(() =>
					t.run(async (ctx) => {
						await ctx.db.insert("github_webhook_events_raw", {
							...makeRawEvent({
								deliveryId: "smoke-pr-1",
								eventName: "pull_request",
								action: "opened",
								repositoryId,
								payloadJson: JSON.stringify({
									action: "opened",
									pull_request: {
										id: 60001,
										number: 10,
										state: "open",
										draft: false,
										title: "Smoke PR: add feature",
										body: "This adds an important feature",
										user: {
											id: 1002,
											login: "dev-bob",
											avatar_url: "https://example.com/bob.png",
											type: "User",
										},
										head: { ref: "feature-smoke", sha: "sha-feature-smoke" },
										base: { ref: "main" },
										assignees: [],
										requested_reviewers: [],
										mergeable_state: null,
										merged_at: null,
										closed_at: null,
										updated_at: "2026-02-18T12:00:00Z",
									},
									repository: {
										full_name: `${ownerLogin}/${repoName}`,
									},
									sender: {
										id: 1002,
										login: "dev-bob",
										avatar_url: "https://example.com/bob.png",
										type: "User",
									},
								}),
							}),
						});
					}),
				);

				// 2c: A push event with 2 commits
				yield* Effect.promise(() =>
					t.run(async (ctx) => {
						await ctx.db.insert("github_webhook_events_raw", {
							...makeRawEvent({
								deliveryId: "smoke-push-1",
								eventName: "push",
								repositoryId,
								payloadJson: JSON.stringify({
									ref: "refs/heads/main",
									after: "sha-after-push",
									deleted: false,
									commits: [
										{
											id: "sha-c1",
											message: "feat: initial setup",
											timestamp: "2026-02-18T09:00:00Z",
										},
										{
											id: "sha-c2",
											message: "fix: typo in readme",
											timestamp: "2026-02-18T09:01:00Z",
										},
									],
									sender: {
										id: 1001,
										login: "dev-alice",
										avatar_url: "https://example.com/alice.png",
										type: "User",
									},
								}),
							}),
						});
					}),
				);

				// 2d: A PR review
				yield* Effect.promise(() =>
					t.run(async (ctx) => {
						await ctx.db.insert("github_webhook_events_raw", {
							...makeRawEvent({
								deliveryId: "smoke-review-1",
								eventName: "pull_request_review",
								action: "submitted",
								repositoryId,
								payloadJson: JSON.stringify({
									action: "submitted",
									review: {
										id: 90001,
										state: "approved",
										user: {
											id: 1003,
											login: "dev-carol",
											avatar_url: null,
											type: "User",
										},
										submitted_at: "2026-02-18T13:00:00Z",
										commit_id: "sha-feature-smoke",
									},
									pull_request: {
										number: 10,
										title: "Smoke PR: add feature",
									},
									sender: {
										id: 1003,
										login: "dev-carol",
										avatar_url: null,
										type: "User",
									},
								}),
							}),
						});
					}),
				);

				// 2e: A check run completed
				yield* Effect.promise(() =>
					t.run(async (ctx) => {
						await ctx.db.insert("github_webhook_events_raw", {
							...makeRawEvent({
								deliveryId: "smoke-checkrun-1",
								eventName: "check_run",
								action: "completed",
								repositoryId,
								payloadJson: JSON.stringify({
									action: "completed",
									check_run: {
										id: 80001,
										name: "CI / Build & Test",
										head_sha: "sha-feature-smoke",
										status: "completed",
										conclusion: "success",
										started_at: "2026-02-18T12:01:00Z",
										completed_at: "2026-02-18T12:03:00Z",
									},
									sender: {
										id: 1002,
										login: "dev-bob",
										avatar_url: "https://example.com/bob.png",
										type: "User",
									},
								}),
							}),
						});
					}),
				);

				// 2f: An issue comment
				yield* Effect.promise(() =>
					t.run(async (ctx) => {
						await ctx.db.insert("github_webhook_events_raw", {
							...makeRawEvent({
								deliveryId: "smoke-comment-1",
								eventName: "issue_comment",
								action: "created",
								repositoryId,
								payloadJson: JSON.stringify({
									action: "created",
									comment: {
										id: 70001,
										body: "I can reproduce this bug.",
										user: {
											id: 1003,
											login: "dev-carol",
											avatar_url: null,
											type: "User",
										},
										created_at: "2026-02-18T14:00:00Z",
										updated_at: "2026-02-18T14:00:00Z",
									},
									issue: {
										number: 1,
										title: "Smoke issue 1",
									},
									sender: {
										id: 1003,
										login: "dev-carol",
										avatar_url: null,
										type: "User",
									},
								}),
							}),
						});
					}),
				);

				// Step 3: Drain pending events via repeated batch processing
				let totalProcessed = 0;
				let totalRetried = 0;
				let totalDeadLettered = 0;

				for (let attempt = 0; attempt < 10; attempt++) {
					const batchResult = yield* Effect.promise(() =>
						t.mutation(internal.rpc.webhookProcessor.processAllPending, {}),
					);
					const batch = assertSuccess(batchResult) as {
						processed: number;
						retried: number;
						deadLettered: number;
					};

					totalProcessed += batch.processed;
					totalRetried += batch.retried;
					totalDeadLettered += batch.deadLettered;

					if (
						batch.processed === 0 &&
						batch.retried === 0 &&
						batch.deadLettered === 0
					) {
						break;
					}
				}

				expect(totalProcessed).toBe(7);
				expect(totalRetried).toBe(0);
				expect(totalDeadLettered).toBe(0);

				// Step 4: Verify domain tables

				// 4a: Users
				const users = yield* Effect.promise(() =>
					t.run(async (ctx) => ctx.db.query("github_users").collect()),
				);
				const userLogins = users.map((u) => u.login).sort();
				expect(userLogins).toEqual(["dev-alice", "dev-bob", "dev-carol"]);

				// 4b: Issues
				const issues = yield* Effect.promise(() =>
					t.run(async (ctx) => ctx.db.query("github_issues").collect()),
				);
				expect(issues).toHaveLength(2);

				// 4c: PRs
				const prs = yield* Effect.promise(() =>
					t.run(async (ctx) => ctx.db.query("github_pull_requests").collect()),
				);
				expect(prs).toHaveLength(1);
				expect(prs[0]).toMatchObject({
					number: 10,
					title: "Smoke PR: add feature",
					headRefName: "feature-smoke",
				});

				// 4d: Commits
				const commits = yield* Effect.promise(() =>
					t.run(async (ctx) => ctx.db.query("github_commits").collect()),
				);
				expect(commits).toHaveLength(2);

				// 4e: Branches (main was seeded + updated by push)
				const branches = yield* Effect.promise(() =>
					t.run(async (ctx) => ctx.db.query("github_branches").collect()),
				);
				expect(branches).toHaveLength(1);
				expect(branches[0]).toMatchObject({
					name: "main",
					headSha: "sha-after-push",
				});

				// 4f: Reviews
				const reviews = yield* Effect.promise(() =>
					t.run(async (ctx) =>
						ctx.db.query("github_pull_request_reviews").collect(),
					),
				);
				expect(reviews).toHaveLength(1);
				expect(reviews[0]).toMatchObject({
					state: "approved",
					pullRequestNumber: 10,
				});

				// 4g: Check runs
				const checkRuns = yield* Effect.promise(() =>
					t.run(async (ctx) => ctx.db.query("github_check_runs").collect()),
				);
				expect(checkRuns).toHaveLength(1);
				expect(checkRuns[0]).toMatchObject({
					name: "CI / Build & Test",
					conclusion: "success",
				});

				// 4h: Issue comments
				const comments = yield* Effect.promise(() =>
					t.run(async (ctx) => ctx.db.query("github_issue_comments").collect()),
				);
				expect(comments).toHaveLength(1);
				expect(comments[0]).toMatchObject({
					body: "I can reproduce this bug.",
					issueNumber: 1,
				});

				// Step 5: Verify projections

				// 5a: Repo overview
				const overviewResult = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.getRepoOverview, {
						ownerLogin,
						name: repoName,
					}),
				);
				const overview = assertSuccess(overviewResult) as {
					openPrCount: number;
					openIssueCount: number;
					fullName: string;
				};
				expect(overview).toMatchObject({
					fullName: `${ownerLogin}/${repoName}`,
					openPrCount: 1,
					openIssueCount: 2,
				});

				// 5b: Repo list
				const listResult = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listRepos, {}),
				);
				const repos = assertSuccess(listResult) as Array<{
					fullName: string;
				}>;
				expect(repos).toHaveLength(1);
				expect(repos[0]).toMatchObject({
					fullName: `${ownerLogin}/${repoName}`,
				});

				// 5c: PR list
				const prListResult = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listPullRequests, {
						ownerLogin,
						name: repoName,
					}),
				);
				const prList = assertSuccess(prListResult) as Array<{
					number: number;
					title: string;
				}>;
				expect(prList).toHaveLength(1);
				expect(prList[0]).toMatchObject({
					number: 10,
					title: "Smoke PR: add feature",
				});

				// 5d: Issue list
				const issueListResult = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listIssues, {
						ownerLogin,
						name: repoName,
					}),
				);
				const issueList = assertSuccess(issueListResult) as Array<{
					number: number;
				}>;
				expect(issueList).toHaveLength(2);

				// 5e: Activity feed
				const activityResult = yield* Effect.promise(() =>
					t.query(api.rpc.projectionQueries.listActivity, {
						ownerLogin,
						name: repoName,
					}),
				);
				const activities = assertSuccess(activityResult) as Array<{
					activityType: string;
				}>;
				// 7 events = 2 issues + 1 PR + 1 push + 1 review + 1 check_run + 1 comment
				expect(activities).toHaveLength(7);

				const activityTypes = activities.map((a) => a.activityType).sort();
				expect(activityTypes).toEqual([
					"check_run.success",
					"issue.opened",
					"issue.opened",
					"issue_comment.created",
					"pr.opened",
					"pr_review.approved",
					"push",
				]);

				// Step 6: Verify all raw events are processed
				const rawEvents = yield* Effect.promise(() =>
					t.run(async (ctx) =>
						ctx.db.query("github_webhook_events_raw").collect(),
					),
				);
				for (const event of rawEvents) {
					expect(event.processState).toBe("processed");
				}

				// Step 7: Queue health should show clean state
				const healthResult = yield* Effect.promise(() =>
					t.query(internal.rpc.webhookProcessor.getQueueHealth, {}),
				);
				const health = assertSuccess(healthResult) as {
					pending: number;
					retry: number;
					failed: number;
					deadLetters: number;
				};
				expect(health).toMatchObject({
					pending: 0,
					retry: 0,
					failed: 0,
					deadLetters: 0,
				});
			}),
	);
});
