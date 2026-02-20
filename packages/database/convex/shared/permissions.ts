import { Context, Data, Effect, Option } from "effect";
import { ConfectQueryCtx } from "../confect";

// ---------------------------------------------------------------------------
// Permission Level
// ---------------------------------------------------------------------------

/**
 * GitHub permission levels, ordered from least to most privileged.
 * Each level is cumulative — e.g. "push" implies "triage" and "pull".
 */
export type GitHubPermissionLevel =
	| "pull"
	| "triage"
	| "push"
	| "maintain"
	| "admin";

/**
 * Numeric rank for each permission level.
 * Higher rank means more privilege.
 */
const PERMISSION_RANK: Record<GitHubPermissionLevel, number> = {
	pull: 0,
	triage: 1,
	push: 2,
	maintain: 3,
	admin: 4,
};

/**
 * Determine the highest permission level from the boolean flags.
 * Returns the most privileged level that is `true`, or `null`
 * if none are set.
 */
const highestPermissionFromFlags = (flags: {
	readonly pull: boolean;
	readonly triage: boolean;
	readonly push: boolean;
	readonly maintain: boolean;
	readonly admin: boolean;
}): GitHubPermissionLevel | null => {
	if (flags.admin) return "admin";
	if (flags.maintain) return "maintain";
	if (flags.push) return "push";
	if (flags.triage) return "triage";
	if (flags.pull) return "pull";
	return null;
};

/**
 * Returns true when `actual` is at least as privileged as `required`.
 */
const meetsRequirement = (
	actual: GitHubPermissionLevel,
	required: GitHubPermissionLevel,
) => PERMISSION_RANK[actual] >= PERMISSION_RANK[required];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InsufficientPermissionError extends Data.TaggedError(
	"InsufficientPermissionError",
)<{
	readonly userId: string;
	readonly repositoryId: number;
	readonly required: GitHubPermissionLevel;
	readonly actual: GitHubPermissionLevel | null;
}> {}

export class NotAuthenticatedError extends Data.TaggedError(
	"NotAuthenticatedError",
)<{
	readonly reason: string;
}> {}

// ---------------------------------------------------------------------------
// Permission proof types
// ---------------------------------------------------------------------------

/**
 * A proof value carried in the Effect context after a permission check
 * succeeds. The shape is the same for every access level — the *tag*
 * distinguishes the required level.
 */
interface RepoAccessProof {
	readonly userId: string;
	readonly repositoryId: number;
}

export class RepoPullAccess extends Context.Tag("@quickhub/RepoPullAccess")<
	RepoPullAccess,
	RepoAccessProof
>() {}

export class RepoTriageAccess extends Context.Tag("@quickhub/RepoTriageAccess")<
	RepoTriageAccess,
	RepoAccessProof
>() {}

export class RepoPushAccess extends Context.Tag("@quickhub/RepoPushAccess")<
	RepoPushAccess,
	RepoAccessProof
>() {}

export class RepoMaintainAccess extends Context.Tag(
	"@quickhub/RepoMaintainAccess",
)<RepoMaintainAccess, RepoAccessProof>() {}

export class RepoAdminAccess extends Context.Tag("@quickhub/RepoAdminAccess")<
	RepoAdminAccess,
	RepoAccessProof
>() {}

// ---------------------------------------------------------------------------
// Core verification
// ---------------------------------------------------------------------------

/**
 * Verify that `userId` has at least `required` permission on the given repo.
 *
 * For **public** repositories the function grants implicit `pull` access to
 * every authenticated user (even without a row in the permissions table).
 *
 * Returns the user's actual permission level on success, or fails with
 * `InsufficientPermissionError`.
 */
export const verifyRepoPermission = (
	userId: string,
	repositoryId: number,
	required: GitHubPermissionLevel,
) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;

		// Look up the explicit permission row
		const permRow = yield* ctx.db
			.query("github_user_repo_permissions")
			.withIndex("by_userId_and_repositoryId", (q) =>
				q.eq("userId", userId).eq("repositoryId", repositoryId),
			)
			.first();

		if (Option.isSome(permRow)) {
			const level = highestPermissionFromFlags(permRow.value);
			if (level !== null && meetsRequirement(level, required)) {
				return level;
			}
			return yield* new InsufficientPermissionError({
				userId,
				repositoryId,
				required,
				actual: level,
			});
		}

		// No explicit permission row — check if the repo is public.
		// Public repos grant implicit "pull" access.
		const repo = yield* ctx.db
			.query("github_repositories")
			.withIndex("by_githubRepoId", (q) => q.eq("githubRepoId", repositoryId))
			.first();

		if (Option.isSome(repo) && !repo.value.private) {
			if (meetsRequirement("pull", required)) {
				return "pull" satisfies GitHubPermissionLevel;
			}
		}

		return yield* new InsufficientPermissionError({
			userId,
			repositoryId,
			required,
			actual: Option.isSome(repo) && !repo.value.private ? "pull" : null,
		});
	});

// ---------------------------------------------------------------------------
// Convenience – require* helpers
// ---------------------------------------------------------------------------

/**
 * Require at least `pull` (read) access. Returns a proof value suitable
 * for `Effect.provideService(RepoPullAccess, proof)`.
 */
export const requirePullAccess = (userId: string, repositoryId: number) =>
	Effect.gen(function* () {
		yield* verifyRepoPermission(userId, repositoryId, "pull");
		return { userId, repositoryId } satisfies RepoAccessProof;
	});

/**
 * Require at least `triage` access.
 */
export const requireTriageAccess = (userId: string, repositoryId: number) =>
	Effect.gen(function* () {
		yield* verifyRepoPermission(userId, repositoryId, "triage");
		return { userId, repositoryId } satisfies RepoAccessProof;
	});

/**
 * Require at least `push` (write) access.
 */
export const requirePushAccess = (userId: string, repositoryId: number) =>
	Effect.gen(function* () {
		yield* verifyRepoPermission(userId, repositoryId, "push");
		return { userId, repositoryId } satisfies RepoAccessProof;
	});

/**
 * Require at least `maintain` access.
 */
export const requireMaintainAccess = (userId: string, repositoryId: number) =>
	Effect.gen(function* () {
		yield* verifyRepoPermission(userId, repositoryId, "maintain");
		return { userId, repositoryId } satisfies RepoAccessProof;
	});

/**
 * Require `admin` access.
 */
export const requireAdminAccess = (userId: string, repositoryId: number) =>
	Effect.gen(function* () {
		yield* verifyRepoPermission(userId, repositoryId, "admin");
		return { userId, repositoryId } satisfies RepoAccessProof;
	});

// ---------------------------------------------------------------------------
// Main entry point — resolveRepoAccess
// ---------------------------------------------------------------------------

/**
 * Resolve the current user's access level for a repository.
 *
 * This is the primary entry point for query-level access checks:
 *
 * - **Public repo, unauthenticated user** → grants `pull` access
 * - **Public repo, authenticated user** → checks permissions table,
 *   falls back to implicit `pull`
 * - **Private repo, unauthenticated user** → fails with `NotAuthenticatedError`
 * - **Private repo, authenticated user** → checks permissions table
 *
 * Returns a `RepoAccessProof` with the resolved `userId` (or `"anonymous"`
 * for unauthenticated public access) and the repository ID.
 */
export const resolveRepoAccess = (repositoryId: number, isPrivate: boolean) =>
	Effect.gen(function* () {
		const ctx = yield* ConfectQueryCtx;
		const identity = yield* ctx.auth.getUserIdentity();

		if (Option.isNone(identity)) {
			// Unauthenticated — only public repos are accessible
			if (!isPrivate) {
				return {
					userId: "anonymous",
					repositoryId,
					level: "pull" satisfies GitHubPermissionLevel,
				};
			}
			return yield* new NotAuthenticatedError({
				reason: "Authentication required to access private repositories",
			});
		}

		const userId = identity.value.subject;

		// Look up explicit permissions
		const permRow = yield* ctx.db
			.query("github_user_repo_permissions")
			.withIndex("by_userId_and_repositoryId", (q) =>
				q.eq("userId", userId).eq("repositoryId", repositoryId),
			)
			.first();

		if (Option.isSome(permRow)) {
			const level = highestPermissionFromFlags(permRow.value);
			if (level !== null) {
				return { userId, repositoryId, level };
			}
		}

		// No explicit permissions — public repos get implicit pull
		if (!isPrivate) {
			return {
				userId,
				repositoryId,
				level: "pull" satisfies GitHubPermissionLevel,
			};
		}

		// Private repo, no permissions
		return yield* new InsufficientPermissionError({
			userId,
			repositoryId,
			required: "pull",
			actual: null,
		});
	});
