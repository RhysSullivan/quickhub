import { createRpcFactory, makeRpcModule } from "@packages/confect/rpc";
import { Effect, Schema } from "effect";
import { internal } from "../_generated/api";
import { ConfectActionCtx, confectSchema } from "../confect";
import { GitHubApiClient, GitHubApiError } from "../shared/githubApi";
import { DatabaseRpcTelemetryLayer } from "./telemetry";

const factory = createRpcFactory({ schema: confectSchema });

// ---------------------------------------------------------------------------
// GitHub response parsing helpers
// ---------------------------------------------------------------------------

const parseNextLink = (linkHeader: string | null): string | null => {
	if (!linkHeader) return null;
	const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
	return matches?.[1] ?? null;
};

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const isoToMs = (v: unknown): number | null => {
	if (typeof v !== "string") return null;
	const ms = new Date(v).getTime();
	return Number.isNaN(ms) ? null : ms;
};

const userType = (v: unknown): "User" | "Bot" | "Organization" =>
	v === "Bot" ? "Bot" : v === "Organization" ? "Organization" : "User";

// ---------------------------------------------------------------------------
// Bootstrap action
// ---------------------------------------------------------------------------

const repoBootstrapModule = makeRpcModule(
	{
		/**
		 * Bootstrap a newly-connected repository by fetching branches,
		 * pull requests, and issues from the GitHub REST API, then writing
		 * them into Convex via internal mutations.
		 *
		 * Called as a scheduled action from `connectRepo`.
		 */
		bootstrapRepo: factory.internalAction(
			{
				payload: {
					githubRepoId: Schema.Number,
					fullName: Schema.String,
					lockKey: Schema.String,
				},
				success: Schema.Struct({
					branches: Schema.Number,
					pullRequests: Schema.Number,
					issues: Schema.Number,
					users: Schema.Number,
				}),
			},
			(args) =>
				Effect.gen(function* () {
					const ctx = yield* ConfectActionCtx;
					const gh = yield* GitHubApiClient;

					// Mark job as running
					yield* ctx.runMutation(
						internal.rpc.bootstrapWrite.updateSyncJobState,
						{ lockKey: args.lockKey, state: "running", lastError: null },
					);

					const result = yield* Effect.gen(function* () {
						// --- Fetch branches ---
						const rawBranches = yield* gh.use(async (fetch) => {
							const res = await fetch(
								`/repos/${args.fullName}/branches?per_page=100`,
							);
							if (!res.ok)
								throw new GitHubApiError({
									status: res.status,
									message: await res.text(),
									url: res.url,
								});
							return (await res.json()) as Array<Record<string, unknown>>;
						});

						const branches = rawBranches.map((b) => ({
							name: str(b.name) ?? "unknown",
							headSha:
								str(
									typeof b.commit === "object" &&
										b.commit !== null &&
										"sha" in b.commit
										? b.commit.sha
										: null,
								) ?? "",
							protected: b.protected === true,
						}));

						yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertBranches, {
							repositoryId: args.githubRepoId,
							branches,
						});

						// --- Fetch pull requests (paginated) ---
						const allPrs: Array<Record<string, unknown>> = [];
						yield* gh.use(async (fetch) => {
							let url: string | null =
								`/repos/${args.fullName}/pulls?state=all&per_page=100`;
							while (url) {
								const res = await fetch(url);
								if (!res.ok)
									throw new GitHubApiError({
										status: res.status,
										message: await res.text(),
										url: res.url,
									});
								const page = (await res.json()) as Array<
									Record<string, unknown>
								>;
								allPrs.push(...page);
								url = parseNextLink(res.headers.get("Link"));
							}
						});

						// Collect unique users from PRs
						const userMap = new Map<
							number,
							{
								githubUserId: number;
								login: string;
								avatarUrl: string | null;
								siteAdmin: boolean;
								type: "User" | "Bot" | "Organization";
							}
						>();

						const collectUser = (u: unknown) => {
							if (
								u !== null &&
								u !== undefined &&
								typeof u === "object" &&
								"id" in u &&
								"login" in u
							) {
								const id = num(u.id);
								const login = str(u.login);
								if (id !== null && login !== null && !userMap.has(id)) {
									userMap.set(id, {
										githubUserId: id,
										login,
										avatarUrl: "avatar_url" in u ? str(u.avatar_url) : null,
										siteAdmin:
											"site_admin" in u ? u.site_admin === true : false,
										type: "type" in u ? userType(u.type) : "User",
									});
								}
								return id;
							}
							return null;
						};

						const pullRequests = allPrs.map((pr) => {
							const authorUserId = collectUser(pr.user);
							const head =
								typeof pr.head === "object" && pr.head !== null
									? (pr.head as Record<string, unknown>)
									: {};
							const base =
								typeof pr.base === "object" && pr.base !== null
									? (pr.base as Record<string, unknown>)
									: {};

							return {
								githubPrId: num(pr.id) ?? 0,
								number: num(pr.number) ?? 0,
								state: (pr.state === "open" ? "open" : "closed") as
									| "open"
									| "closed",
								draft: pr.draft === true,
								title: str(pr.title) ?? "",
								body: str(pr.body),
								authorUserId,
								assigneeUserIds: [] as Array<number>,
								requestedReviewerUserIds: [] as Array<number>,
								baseRefName: str(base.ref) ?? "",
								headRefName: str(head.ref) ?? "",
								headSha: str(head.sha) ?? "",
								mergeableState: str(pr.mergeable_state),
								mergedAt: isoToMs(pr.merged_at),
								closedAt: isoToMs(pr.closed_at),
								githubUpdatedAt: isoToMs(pr.updated_at) ?? Date.now(),
							};
						});

						// Write PRs in batches of 50 to stay within Convex mutation limits
						for (let i = 0; i < pullRequests.length; i += 50) {
							yield* ctx.runMutation(
								internal.rpc.bootstrapWrite.upsertPullRequests,
								{
									repositoryId: args.githubRepoId,
									pullRequests: pullRequests.slice(i, i + 50),
								},
							);
						}

						// --- Fetch issues (paginated, excludes PRs) ---
						const allIssues: Array<Record<string, unknown>> = [];
						yield* gh.use(async (fetch) => {
							let url: string | null =
								`/repos/${args.fullName}/issues?state=all&per_page=100`;
							while (url) {
								const res = await fetch(url);
								if (!res.ok)
									throw new GitHubApiError({
										status: res.status,
										message: await res.text(),
										url: res.url,
									});
								const page = (await res.json()) as Array<
									Record<string, unknown>
								>;
								// GitHub's issues API includes PRs — filter them out
								allIssues.push(
									...page.filter((item) => !("pull_request" in item)),
								);
								url = parseNextLink(res.headers.get("Link"));
							}
						});

						const issues = allIssues.map((issue) => {
							const authorUserId = collectUser(issue.user);
							const labels = Array.isArray(issue.labels)
								? issue.labels
										.map((l: unknown) =>
											typeof l === "object" &&
											l !== null &&
											"name" in l &&
											typeof l.name === "string"
												? l.name
												: null,
										)
										.filter((n: string | null): n is string => n !== null)
								: [];

							return {
								githubIssueId: num(issue.id) ?? 0,
								number: num(issue.number) ?? 0,
								state: (issue.state === "open" ? "open" : "closed") as
									| "open"
									| "closed",
								title: str(issue.title) ?? "",
								body: str(issue.body),
								authorUserId,
								assigneeUserIds: [] as Array<number>,
								labelNames: labels,
								commentCount: num(issue.comments) ?? 0,
								isPullRequest: false,
								closedAt: isoToMs(issue.closed_at),
								githubUpdatedAt: isoToMs(issue.updated_at) ?? Date.now(),
							};
						});

						// Write issues in batches
						for (let i = 0; i < issues.length; i += 50) {
							yield* ctx.runMutation(internal.rpc.bootstrapWrite.upsertIssues, {
								repositoryId: args.githubRepoId,
								issues: issues.slice(i, i + 50),
							});
						}

						// --- Upsert collected users ---
						const users = [...userMap.values()];
						if (users.length > 0) {
							for (let i = 0; i < users.length; i += 50) {
								yield* ctx.runMutation(
									internal.rpc.bootstrapWrite.upsertUsers,
									{ users: users.slice(i, i + 50) },
								);
							}
						}

						return {
							branches: branches.length,
							pullRequests: pullRequests.length,
							issues: issues.length,
							users: users.length,
						};
					}).pipe(
						// On failure, mark job as failed
						Effect.tapError((error) =>
							ctx
								.runMutation(internal.rpc.bootstrapWrite.updateSyncJobState, {
									lockKey: args.lockKey,
									state: "failed",
									lastError: String(error),
								})
								.pipe(Effect.ignoreLogged),
						),
					);

					// Mark job as done
					yield* ctx.runMutation(
						internal.rpc.bootstrapWrite.updateSyncJobState,
						{ lockKey: args.lockKey, state: "done", lastError: null },
					);

					return result;
				}).pipe(Effect.provide(GitHubApiClient.Default)),
		),
	},
	{ middlewares: DatabaseRpcTelemetryLayer },
);

export const { bootstrapRepo } = repoBootstrapModule.handlers;
export { repoBootstrapModule };
export type RepoBootstrapModule = typeof repoBootstrapModule;
