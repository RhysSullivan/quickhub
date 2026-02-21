import type * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientError from "@effect/platform/HttpClientError";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { ParseError } from "effect/ParseResult";
import * as S from "effect/Schema";

export class AppsCreateInstallationAccessTokenParams extends S.Struct({}) {}

/**
 * The level of permission to grant the access token for GitHub Actions workflows, workflow runs, and artifacts.
 */
export class AppPermissionsActions extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token for repository creation, deletion, settings, teams, and collaborators creation.
 */
export class AppPermissionsAdministration extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to create and retrieve build artifact metadata records.
 */
export class AppPermissionsArtifactMetadata extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to create and retrieve the access token for repository attestations.
 */
export class AppPermissionsAttestations extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token for checks on code.
 */
export class AppPermissionsChecks extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to create, edit, delete, and list Codespaces.
 */
export class AppPermissionsCodespaces extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token for repository contents, commits, branches, downloads, releases, and merges.
 */
export class AppPermissionsContents extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to manage Dependabot secrets.
 */
export class AppPermissionsDependabotSecrets extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token for deployments and deployment statuses.
 */
export class AppPermissionsDeployments extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token for discussions and related comments and labels.
 */
export class AppPermissionsDiscussions extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token for managing repository environments.
 */
export class AppPermissionsEnvironments extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token for issues and related comments, assignees, labels, and milestones.
 */
export class AppPermissionsIssues extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to manage the merge queues for a repository.
 */
export class AppPermissionsMergeQueues extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to search repositories, list collaborators, and access repository metadata.
 */
export class AppPermissionsMetadata extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token for packages published to GitHub Packages.
 */
export class AppPermissionsPackages extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to retrieve Pages statuses, configuration, and builds, as well as create new builds.
 */
export class AppPermissionsPages extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token for pull requests and related comments, assignees, labels, milestones, and merges.
 */
export class AppPermissionsPullRequests extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to view and edit custom properties for a repository, when allowed by the property.
 */
export class AppPermissionsRepositoryCustomProperties extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token to manage the post-receive hooks for a repository.
 */
export class AppPermissionsRepositoryHooks extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to manage repository projects, columns, and cards.
 */
export class AppPermissionsRepositoryProjects extends S.Literal(
	"read",
	"write",
	"admin",
) {}

/**
 * The level of permission to grant the access token to view and manage secret scanning alerts.
 */
export class AppPermissionsSecretScanningAlerts extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token to manage repository secrets.
 */
export class AppPermissionsSecrets extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to view and manage security events like code scanning alerts.
 */
export class AppPermissionsSecurityEvents extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to manage just a single file.
 */
export class AppPermissionsSingleFile extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token for commit statuses.
 */
export class AppPermissionsStatuses extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to manage Dependabot alerts.
 */
export class AppPermissionsVulnerabilityAlerts extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token to update GitHub Actions workflow files.
 */
export class AppPermissionsWorkflows extends S.Literal("write") {}

/**
 * The level of permission to grant the access token to view and edit custom properties for an organization, when allowed by the property.
 */
export class AppPermissionsCustomPropertiesForOrganizations extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token for organization teams and members.
 */
export class AppPermissionsMembers extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to manage access to an organization.
 */
export class AppPermissionsOrganizationAdministration extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token for custom repository roles management.
 */
export class AppPermissionsOrganizationCustomRoles extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token for custom organization roles management.
 */
export class AppPermissionsOrganizationCustomOrgRoles extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token for repository custom properties management at the organization level.
 */
export class AppPermissionsOrganizationCustomProperties extends S.Literal(
	"read",
	"write",
	"admin",
) {}

/**
 * The level of permission to grant the access token for managing access to GitHub Copilot for members of an organization with a Copilot Business subscription. This property is in public preview and is subject to change.
 */
export class AppPermissionsOrganizationCopilotSeatManagement extends S.Literal(
	"write",
) {}

/**
 * The level of permission to grant the access token to view and manage announcement banners for an organization.
 */
export class AppPermissionsOrganizationAnnouncementBanners extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token to view events triggered by an activity in an organization.
 */
export class AppPermissionsOrganizationEvents extends S.Literal("read") {}

/**
 * The level of permission to grant the access token to manage the post-receive hooks for an organization.
 */
export class AppPermissionsOrganizationHooks extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token for viewing and managing fine-grained personal access token requests to an organization.
 */
export class AppPermissionsOrganizationPersonalAccessTokens extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token for viewing and managing fine-grained personal access tokens that have been approved by an organization.
 */
export class AppPermissionsOrganizationPersonalAccessTokenRequests extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token for viewing an organization's plan.
 */
export class AppPermissionsOrganizationPlan extends S.Literal("read") {}

/**
 * The level of permission to grant the access token to manage organization projects and projects public preview (where available).
 */
export class AppPermissionsOrganizationProjects extends S.Literal(
	"read",
	"write",
	"admin",
) {}

/**
 * The level of permission to grant the access token for organization packages published to GitHub Packages.
 */
export class AppPermissionsOrganizationPackages extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token to manage organization secrets.
 */
export class AppPermissionsOrganizationSecrets extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token to view and manage GitHub Actions self-hosted runners available to an organization.
 */
export class AppPermissionsOrganizationSelfHostedRunners extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token to view and manage users blocked by the organization.
 */
export class AppPermissionsOrganizationUserBlocking extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token to manage the email addresses belonging to a user.
 */
export class AppPermissionsEmailAddresses extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to manage the followers belonging to a user.
 */
export class AppPermissionsFollowers extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to manage git SSH keys.
 */
export class AppPermissionsGitSshKeys extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to view and manage GPG keys belonging to a user.
 */
export class AppPermissionsGpgKeys extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token to view and manage interaction limits on a repository.
 */
export class AppPermissionsInteractionLimits extends S.Literal(
	"read",
	"write",
) {}

/**
 * The level of permission to grant the access token to manage the profile settings belonging to a user.
 */
export class AppPermissionsProfile extends S.Literal("write") {}

/**
 * The level of permission to grant the access token to list and manage repositories a user is starring.
 */
export class AppPermissionsStarring extends S.Literal("read", "write") {}

/**
 * The level of permission to grant the access token for organization custom properties management at the enterprise level.
 */
export class AppPermissionsEnterpriseCustomPropertiesForOrganizations extends S.Literal(
	"read",
	"write",
	"admin",
) {}

/**
 * The permissions granted to the user access token.
 */
export class AppPermissions extends S.Class<AppPermissions>("AppPermissions")({
	/**
	 * The level of permission to grant the access token for GitHub Actions workflows, workflow runs, and artifacts.
	 */
	actions: S.optionalWith(AppPermissionsActions, { nullable: true }),
	/**
	 * The level of permission to grant the access token for repository creation, deletion, settings, teams, and collaborators creation.
	 */
	administration: S.optionalWith(AppPermissionsAdministration, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to create and retrieve build artifact metadata records.
	 */
	artifact_metadata: S.optionalWith(AppPermissionsArtifactMetadata, {
		nullable: true,
	}),
	/**
	 * The level of permission to create and retrieve the access token for repository attestations.
	 */
	attestations: S.optionalWith(AppPermissionsAttestations, { nullable: true }),
	/**
	 * The level of permission to grant the access token for checks on code.
	 */
	checks: S.optionalWith(AppPermissionsChecks, { nullable: true }),
	/**
	 * The level of permission to grant the access token to create, edit, delete, and list Codespaces.
	 */
	codespaces: S.optionalWith(AppPermissionsCodespaces, { nullable: true }),
	/**
	 * The level of permission to grant the access token for repository contents, commits, branches, downloads, releases, and merges.
	 */
	contents: S.optionalWith(AppPermissionsContents, { nullable: true }),
	/**
	 * The level of permission to grant the access token to manage Dependabot secrets.
	 */
	dependabot_secrets: S.optionalWith(AppPermissionsDependabotSecrets, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token for deployments and deployment statuses.
	 */
	deployments: S.optionalWith(AppPermissionsDeployments, { nullable: true }),
	/**
	 * The level of permission to grant the access token for discussions and related comments and labels.
	 */
	discussions: S.optionalWith(AppPermissionsDiscussions, { nullable: true }),
	/**
	 * The level of permission to grant the access token for managing repository environments.
	 */
	environments: S.optionalWith(AppPermissionsEnvironments, { nullable: true }),
	/**
	 * The level of permission to grant the access token for issues and related comments, assignees, labels, and milestones.
	 */
	issues: S.optionalWith(AppPermissionsIssues, { nullable: true }),
	/**
	 * The level of permission to grant the access token to manage the merge queues for a repository.
	 */
	merge_queues: S.optionalWith(AppPermissionsMergeQueues, { nullable: true }),
	/**
	 * The level of permission to grant the access token to search repositories, list collaborators, and access repository metadata.
	 */
	metadata: S.optionalWith(AppPermissionsMetadata, { nullable: true }),
	/**
	 * The level of permission to grant the access token for packages published to GitHub Packages.
	 */
	packages: S.optionalWith(AppPermissionsPackages, { nullable: true }),
	/**
	 * The level of permission to grant the access token to retrieve Pages statuses, configuration, and builds, as well as create new builds.
	 */
	pages: S.optionalWith(AppPermissionsPages, { nullable: true }),
	/**
	 * The level of permission to grant the access token for pull requests and related comments, assignees, labels, milestones, and merges.
	 */
	pull_requests: S.optionalWith(AppPermissionsPullRequests, { nullable: true }),
	/**
	 * The level of permission to grant the access token to view and edit custom properties for a repository, when allowed by the property.
	 */
	repository_custom_properties: S.optionalWith(
		AppPermissionsRepositoryCustomProperties,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token to manage the post-receive hooks for a repository.
	 */
	repository_hooks: S.optionalWith(AppPermissionsRepositoryHooks, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to manage repository projects, columns, and cards.
	 */
	repository_projects: S.optionalWith(AppPermissionsRepositoryProjects, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to view and manage secret scanning alerts.
	 */
	secret_scanning_alerts: S.optionalWith(AppPermissionsSecretScanningAlerts, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to manage repository secrets.
	 */
	secrets: S.optionalWith(AppPermissionsSecrets, { nullable: true }),
	/**
	 * The level of permission to grant the access token to view and manage security events like code scanning alerts.
	 */
	security_events: S.optionalWith(AppPermissionsSecurityEvents, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to manage just a single file.
	 */
	single_file: S.optionalWith(AppPermissionsSingleFile, { nullable: true }),
	/**
	 * The level of permission to grant the access token for commit statuses.
	 */
	statuses: S.optionalWith(AppPermissionsStatuses, { nullable: true }),
	/**
	 * The level of permission to grant the access token to manage Dependabot alerts.
	 */
	vulnerability_alerts: S.optionalWith(AppPermissionsVulnerabilityAlerts, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to update GitHub Actions workflow files.
	 */
	workflows: S.optionalWith(AppPermissionsWorkflows, { nullable: true }),
	/**
	 * The level of permission to grant the access token to view and edit custom properties for an organization, when allowed by the property.
	 */
	custom_properties_for_organizations: S.optionalWith(
		AppPermissionsCustomPropertiesForOrganizations,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token for organization teams and members.
	 */
	members: S.optionalWith(AppPermissionsMembers, { nullable: true }),
	/**
	 * The level of permission to grant the access token to manage access to an organization.
	 */
	organization_administration: S.optionalWith(
		AppPermissionsOrganizationAdministration,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token for custom repository roles management.
	 */
	organization_custom_roles: S.optionalWith(
		AppPermissionsOrganizationCustomRoles,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token for custom organization roles management.
	 */
	organization_custom_org_roles: S.optionalWith(
		AppPermissionsOrganizationCustomOrgRoles,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token for repository custom properties management at the organization level.
	 */
	organization_custom_properties: S.optionalWith(
		AppPermissionsOrganizationCustomProperties,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token for managing access to GitHub Copilot for members of an organization with a Copilot Business subscription. This property is in public preview and is subject to change.
	 */
	organization_copilot_seat_management: S.optionalWith(
		AppPermissionsOrganizationCopilotSeatManagement,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token to view and manage announcement banners for an organization.
	 */
	organization_announcement_banners: S.optionalWith(
		AppPermissionsOrganizationAnnouncementBanners,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token to view events triggered by an activity in an organization.
	 */
	organization_events: S.optionalWith(AppPermissionsOrganizationEvents, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to manage the post-receive hooks for an organization.
	 */
	organization_hooks: S.optionalWith(AppPermissionsOrganizationHooks, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token for viewing and managing fine-grained personal access token requests to an organization.
	 */
	organization_personal_access_tokens: S.optionalWith(
		AppPermissionsOrganizationPersonalAccessTokens,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token for viewing and managing fine-grained personal access tokens that have been approved by an organization.
	 */
	organization_personal_access_token_requests: S.optionalWith(
		AppPermissionsOrganizationPersonalAccessTokenRequests,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token for viewing an organization's plan.
	 */
	organization_plan: S.optionalWith(AppPermissionsOrganizationPlan, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to manage organization projects and projects public preview (where available).
	 */
	organization_projects: S.optionalWith(AppPermissionsOrganizationProjects, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token for organization packages published to GitHub Packages.
	 */
	organization_packages: S.optionalWith(AppPermissionsOrganizationPackages, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to manage organization secrets.
	 */
	organization_secrets: S.optionalWith(AppPermissionsOrganizationSecrets, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to view and manage GitHub Actions self-hosted runners available to an organization.
	 */
	organization_self_hosted_runners: S.optionalWith(
		AppPermissionsOrganizationSelfHostedRunners,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token to view and manage users blocked by the organization.
	 */
	organization_user_blocking: S.optionalWith(
		AppPermissionsOrganizationUserBlocking,
		{ nullable: true },
	),
	/**
	 * The level of permission to grant the access token to manage the email addresses belonging to a user.
	 */
	email_addresses: S.optionalWith(AppPermissionsEmailAddresses, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to manage the followers belonging to a user.
	 */
	followers: S.optionalWith(AppPermissionsFollowers, { nullable: true }),
	/**
	 * The level of permission to grant the access token to manage git SSH keys.
	 */
	git_ssh_keys: S.optionalWith(AppPermissionsGitSshKeys, { nullable: true }),
	/**
	 * The level of permission to grant the access token to view and manage GPG keys belonging to a user.
	 */
	gpg_keys: S.optionalWith(AppPermissionsGpgKeys, { nullable: true }),
	/**
	 * The level of permission to grant the access token to view and manage interaction limits on a repository.
	 */
	interaction_limits: S.optionalWith(AppPermissionsInteractionLimits, {
		nullable: true,
	}),
	/**
	 * The level of permission to grant the access token to manage the profile settings belonging to a user.
	 */
	profile: S.optionalWith(AppPermissionsProfile, { nullable: true }),
	/**
	 * The level of permission to grant the access token to list and manage repositories a user is starring.
	 */
	starring: S.optionalWith(AppPermissionsStarring, { nullable: true }),
	/**
	 * The level of permission to grant the access token for organization custom properties management at the enterprise level.
	 */
	enterprise_custom_properties_for_organizations: S.optionalWith(
		AppPermissionsEnterpriseCustomPropertiesForOrganizations,
		{ nullable: true },
	),
}) {}

export class AppsCreateInstallationAccessTokenRequest extends S.Class<AppsCreateInstallationAccessTokenRequest>(
	"AppsCreateInstallationAccessTokenRequest",
)({
	/**
	 * List of repository names that the token should have access to
	 */
	repositories: S.optionalWith(S.Array(S.String), { nullable: true }),
	/**
	 * List of repository IDs that the token should have access to
	 */
	repository_ids: S.optionalWith(S.Array(S.Int), { nullable: true }),
	permissions: S.optionalWith(AppPermissions, { nullable: true }),
}) {}

export class InstallationTokenRepositorySelection extends S.Literal(
	"all",
	"selected",
) {}

/**
 * License Simple
 */
export class NullableLicenseSimple extends S.Class<NullableLicenseSimple>(
	"NullableLicenseSimple",
)({
	key: S.String,
	name: S.String,
	url: S.NullOr(S.String),
	spdx_id: S.NullOr(S.String),
	node_id: S.String,
	html_url: S.optionalWith(S.String, { nullable: true }),
}) {}

/**
 * A GitHub user.
 */
export class SimpleUser extends S.Class<SimpleUser>("SimpleUser")({
	name: S.optionalWith(S.String, { nullable: true }),
	email: S.optionalWith(S.String, { nullable: true }),
	login: S.String,
	id: S.Int,
	node_id: S.String,
	avatar_url: S.String,
	gravatar_id: S.NullOr(S.String),
	url: S.String,
	html_url: S.String,
	followers_url: S.String,
	following_url: S.String,
	gists_url: S.String,
	starred_url: S.String,
	subscriptions_url: S.String,
	organizations_url: S.String,
	repos_url: S.String,
	events_url: S.String,
	received_events_url: S.String,
	type: S.String,
	site_admin: S.Boolean,
	starred_at: S.optionalWith(S.String, { nullable: true }),
	user_view_type: S.optionalWith(S.String, { nullable: true }),
}) {}

/**
 * The policy controlling who can create pull requests: all or collaborators_only.
 */
export class RepositoryPullRequestCreationPolicy extends S.Literal(
	"all",
	"collaborators_only",
) {}

/**
 * The default value for a squash merge commit title:
 *
 * - `PR_TITLE` - default to the pull request's title.
 * - `COMMIT_OR_PR_TITLE` - default to the commit's title (if only one commit) or the pull request's title (when more than one commit).
 */
export class RepositorySquashMergeCommitTitle extends S.Literal(
	"PR_TITLE",
	"COMMIT_OR_PR_TITLE",
) {}

/**
 * The default value for a squash merge commit message:
 *
 * - `PR_BODY` - default to the pull request's body.
 * - `COMMIT_MESSAGES` - default to the branch's commit messages.
 * - `BLANK` - default to a blank commit message.
 */
export class RepositorySquashMergeCommitMessage extends S.Literal(
	"PR_BODY",
	"COMMIT_MESSAGES",
	"BLANK",
) {}

/**
 * The default value for a merge commit title.
 *
 * - `PR_TITLE` - default to the pull request's title.
 * - `MERGE_MESSAGE` - default to the classic title for a merge message (e.g., Merge pull request #123 from branch-name).
 */
export class RepositoryMergeCommitTitle extends S.Literal(
	"PR_TITLE",
	"MERGE_MESSAGE",
) {}

/**
 * The default value for a merge commit message.
 *
 * - `PR_TITLE` - default to the pull request's title.
 * - `PR_BODY` - default to the pull request's body.
 * - `BLANK` - default to a blank commit message.
 */
export class RepositoryMergeCommitMessage extends S.Literal(
	"PR_BODY",
	"PR_TITLE",
	"BLANK",
) {}

/**
 * A repository on GitHub.
 */
export class Repository extends S.Class<Repository>("Repository")({
	/**
	 * Unique identifier of the repository
	 */
	id: S.Int,
	node_id: S.String,
	/**
	 * The name of the repository.
	 */
	name: S.String,
	full_name: S.String,
	license: S.NullOr(NullableLicenseSimple),
	forks: S.Int,
	permissions: S.optionalWith(
		S.Struct({
			admin: S.Boolean,
			pull: S.Boolean,
			triage: S.optionalWith(S.Boolean, { nullable: true }),
			push: S.Boolean,
			maintain: S.optionalWith(S.Boolean, { nullable: true }),
		}),
		{ nullable: true },
	),
	owner: SimpleUser,
	/**
	 * Whether the repository is private or public.
	 */
	private: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => false as const),
	),
	html_url: S.String,
	description: S.NullOr(S.String),
	fork: S.Boolean,
	url: S.String,
	archive_url: S.String,
	assignees_url: S.String,
	blobs_url: S.String,
	branches_url: S.String,
	collaborators_url: S.String,
	comments_url: S.String,
	commits_url: S.String,
	compare_url: S.String,
	contents_url: S.String,
	contributors_url: S.String,
	deployments_url: S.String,
	downloads_url: S.String,
	events_url: S.String,
	forks_url: S.String,
	git_commits_url: S.String,
	git_refs_url: S.String,
	git_tags_url: S.String,
	git_url: S.String,
	issue_comment_url: S.String,
	issue_events_url: S.String,
	issues_url: S.String,
	keys_url: S.String,
	labels_url: S.String,
	languages_url: S.String,
	merges_url: S.String,
	milestones_url: S.String,
	notifications_url: S.String,
	pulls_url: S.String,
	releases_url: S.String,
	ssh_url: S.String,
	stargazers_url: S.String,
	statuses_url: S.String,
	subscribers_url: S.String,
	subscription_url: S.String,
	tags_url: S.String,
	teams_url: S.String,
	trees_url: S.String,
	clone_url: S.String,
	mirror_url: S.NullOr(S.String),
	hooks_url: S.String,
	svn_url: S.String,
	homepage: S.NullOr(S.String),
	language: S.NullOr(S.String),
	forks_count: S.Int,
	stargazers_count: S.Int,
	watchers_count: S.Int,
	/**
	 * The size of the repository, in kilobytes. Size is calculated hourly. When a repository is initially created, the size is 0.
	 */
	size: S.Int,
	/**
	 * The default branch of the repository.
	 */
	default_branch: S.String,
	open_issues_count: S.Int,
	/**
	 * Whether this repository acts as a template that can be used to generate new repositories.
	 */
	is_template: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	topics: S.optionalWith(S.Array(S.String), { nullable: true }),
	/**
	 * Whether issues are enabled.
	 */
	has_issues: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => true as const),
	),
	/**
	 * Whether projects are enabled.
	 */
	has_projects: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => true as const),
	),
	/**
	 * Whether the wiki is enabled.
	 */
	has_wiki: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => true as const),
	),
	has_pages: S.Boolean,
	/**
	 * Whether downloads are enabled.
	 */
	has_downloads: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => true as const),
	),
	/**
	 * Whether discussions are enabled.
	 */
	has_discussions: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	/**
	 * Whether pull requests are enabled.
	 */
	has_pull_requests: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => true as const,
	}),
	/**
	 * The policy controlling who can create pull requests: all or collaborators_only.
	 */
	pull_request_creation_policy: S.optionalWith(
		RepositoryPullRequestCreationPolicy,
		{ nullable: true },
	),
	/**
	 * Whether the repository is archived.
	 */
	archived: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => false as const),
	),
	/**
	 * Returns whether or not this repository disabled.
	 */
	disabled: S.Boolean,
	/**
	 * The repository visibility: public, private, or internal.
	 */
	visibility: S.optionalWith(S.String, {
		nullable: true,
		default: () => "public" as const,
	}),
	pushed_at: S.NullOr(S.String),
	created_at: S.NullOr(S.String),
	updated_at: S.NullOr(S.String),
	/**
	 * Whether to allow rebase merges for pull requests.
	 */
	allow_rebase_merge: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => true as const,
	}),
	temp_clone_token: S.optionalWith(S.String, { nullable: true }),
	/**
	 * Whether to allow squash merges for pull requests.
	 */
	allow_squash_merge: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => true as const,
	}),
	/**
	 * Whether to allow Auto-merge to be used on pull requests.
	 */
	allow_auto_merge: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	/**
	 * Whether to delete head branches when pull requests are merged
	 */
	delete_branch_on_merge: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	/**
	 * Whether or not a pull request head branch that is behind its base branch can always be updated even if it is not required to be up to date before merging.
	 */
	allow_update_branch: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	/**
	 * Whether a squash merge commit can use the pull request title as default. **This property is closing down. Please use `squash_merge_commit_title` instead.
	 */
	use_squash_pr_title_as_default: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	/**
	 * The default value for a squash merge commit title:
	 *
	 * - `PR_TITLE` - default to the pull request's title.
	 * - `COMMIT_OR_PR_TITLE` - default to the commit's title (if only one commit) or the pull request's title (when more than one commit).
	 */
	squash_merge_commit_title: S.optionalWith(RepositorySquashMergeCommitTitle, {
		nullable: true,
	}),
	/**
	 * The default value for a squash merge commit message:
	 *
	 * - `PR_BODY` - default to the pull request's body.
	 * - `COMMIT_MESSAGES` - default to the branch's commit messages.
	 * - `BLANK` - default to a blank commit message.
	 */
	squash_merge_commit_message: S.optionalWith(
		RepositorySquashMergeCommitMessage,
		{ nullable: true },
	),
	/**
	 * The default value for a merge commit title.
	 *
	 * - `PR_TITLE` - default to the pull request's title.
	 * - `MERGE_MESSAGE` - default to the classic title for a merge message (e.g., Merge pull request #123 from branch-name).
	 */
	merge_commit_title: S.optionalWith(RepositoryMergeCommitTitle, {
		nullable: true,
	}),
	/**
	 * The default value for a merge commit message.
	 *
	 * - `PR_TITLE` - default to the pull request's title.
	 * - `PR_BODY` - default to the pull request's body.
	 * - `BLANK` - default to a blank commit message.
	 */
	merge_commit_message: S.optionalWith(RepositoryMergeCommitMessage, {
		nullable: true,
	}),
	/**
	 * Whether to allow merge commits for pull requests.
	 */
	allow_merge_commit: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => true as const,
	}),
	/**
	 * Whether to allow forking this repo
	 */
	allow_forking: S.optionalWith(S.Boolean, { nullable: true }),
	/**
	 * Whether to require contributors to sign off on web-based commits
	 */
	web_commit_signoff_required: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	open_issues: S.Int,
	watchers: S.Int,
	master_branch: S.optionalWith(S.String, { nullable: true }),
	starred_at: S.optionalWith(S.String, { nullable: true }),
	/**
	 * Whether anonymous git access is enabled for this repository
	 */
	anonymous_access_enabled: S.optionalWith(S.Boolean, { nullable: true }),
	/**
	 * The status of the code search index for this repository
	 */
	code_search_index_status: S.optionalWith(
		S.Struct({
			lexical_search_ok: S.optionalWith(S.Boolean, { nullable: true }),
			lexical_commit_sha: S.optionalWith(S.String, { nullable: true }),
		}),
		{ nullable: true },
	),
}) {}

/**
 * Authentication token for a GitHub App installed on a user or org.
 */
export class InstallationToken extends S.Class<InstallationToken>(
	"InstallationToken",
)({
	token: S.String,
	expires_at: S.String,
	permissions: S.optionalWith(AppPermissions, { nullable: true }),
	repository_selection: S.optionalWith(InstallationTokenRepositorySelection, {
		nullable: true,
	}),
	repositories: S.optionalWith(S.Array(Repository), { nullable: true }),
	single_file: S.optionalWith(S.String, { nullable: true }),
	has_multiple_single_files: S.optionalWith(S.Boolean, { nullable: true }),
	single_file_paths: S.optionalWith(S.Array(S.String), { nullable: true }),
}) {}

/**
 * Basic Error
 */
export class BasicError extends S.Class<BasicError>("BasicError")({
	message: S.optionalWith(S.String, { nullable: true }),
	documentation_url: S.optionalWith(S.String, { nullable: true }),
	url: S.optionalWith(S.String, { nullable: true }),
	status: S.optionalWith(S.String, { nullable: true }),
}) {}

/**
 * Validation Error
 */
export class ValidationError extends S.Class<ValidationError>(
	"ValidationError",
)({
	message: S.String,
	documentation_url: S.String,
	errors: S.optionalWith(
		S.Array(
			S.Struct({
				resource: S.optionalWith(S.String, { nullable: true }),
				field: S.optionalWith(S.String, { nullable: true }),
				message: S.optionalWith(S.String, { nullable: true }),
				code: S.String,
				index: S.optionalWith(S.Int, { nullable: true }),
				value: S.optionalWith(S.Union(S.String, S.Int, S.Array(S.String)), {
					nullable: true,
				}),
			}),
		),
		{ nullable: true },
	),
}) {}

export class ReposGetParams extends S.Struct({}) {}

/**
 * The policy controlling who can create pull requests: all or collaborators_only.
 */
export class FullRepositoryPullRequestCreationPolicy extends S.Literal(
	"all",
	"collaborators_only",
) {}

/**
 * The policy controlling who can create pull requests: all or collaborators_only.
 */
export class NullableRepositoryPullRequestCreationPolicy extends S.Literal(
	"all",
	"collaborators_only",
) {}

/**
 * The default value for a squash merge commit title:
 *
 * - `PR_TITLE` - default to the pull request's title.
 * - `COMMIT_OR_PR_TITLE` - default to the commit's title (if only one commit) or the pull request's title (when more than one commit).
 */
export class NullableRepositorySquashMergeCommitTitle extends S.Literal(
	"PR_TITLE",
	"COMMIT_OR_PR_TITLE",
) {}

/**
 * The default value for a squash merge commit message:
 *
 * - `PR_BODY` - default to the pull request's body.
 * - `COMMIT_MESSAGES` - default to the branch's commit messages.
 * - `BLANK` - default to a blank commit message.
 */
export class NullableRepositorySquashMergeCommitMessage extends S.Literal(
	"PR_BODY",
	"COMMIT_MESSAGES",
	"BLANK",
) {}

/**
 * The default value for a merge commit title.
 *
 * - `PR_TITLE` - default to the pull request's title.
 * - `MERGE_MESSAGE` - default to the classic title for a merge message (e.g., Merge pull request #123 from branch-name).
 */
export class NullableRepositoryMergeCommitTitle extends S.Literal(
	"PR_TITLE",
	"MERGE_MESSAGE",
) {}

/**
 * The default value for a merge commit message.
 *
 * - `PR_TITLE` - default to the pull request's title.
 * - `PR_BODY` - default to the pull request's body.
 * - `BLANK` - default to a blank commit message.
 */
export class NullableRepositoryMergeCommitMessage extends S.Literal(
	"PR_BODY",
	"PR_TITLE",
	"BLANK",
) {}

/**
 * A repository on GitHub.
 */
export class NullableRepository extends S.Class<NullableRepository>(
	"NullableRepository",
)({
	/**
	 * Unique identifier of the repository
	 */
	id: S.Int,
	node_id: S.String,
	/**
	 * The name of the repository.
	 */
	name: S.String,
	full_name: S.String,
	license: S.NullOr(NullableLicenseSimple),
	forks: S.Int,
	permissions: S.optionalWith(
		S.Struct({
			admin: S.Boolean,
			pull: S.Boolean,
			triage: S.optionalWith(S.Boolean, { nullable: true }),
			push: S.Boolean,
			maintain: S.optionalWith(S.Boolean, { nullable: true }),
		}),
		{ nullable: true },
	),
	owner: SimpleUser,
	/**
	 * Whether the repository is private or public.
	 */
	private: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => false as const),
	),
	html_url: S.String,
	description: S.NullOr(S.String),
	fork: S.Boolean,
	url: S.String,
	archive_url: S.String,
	assignees_url: S.String,
	blobs_url: S.String,
	branches_url: S.String,
	collaborators_url: S.String,
	comments_url: S.String,
	commits_url: S.String,
	compare_url: S.String,
	contents_url: S.String,
	contributors_url: S.String,
	deployments_url: S.String,
	downloads_url: S.String,
	events_url: S.String,
	forks_url: S.String,
	git_commits_url: S.String,
	git_refs_url: S.String,
	git_tags_url: S.String,
	git_url: S.String,
	issue_comment_url: S.String,
	issue_events_url: S.String,
	issues_url: S.String,
	keys_url: S.String,
	labels_url: S.String,
	languages_url: S.String,
	merges_url: S.String,
	milestones_url: S.String,
	notifications_url: S.String,
	pulls_url: S.String,
	releases_url: S.String,
	ssh_url: S.String,
	stargazers_url: S.String,
	statuses_url: S.String,
	subscribers_url: S.String,
	subscription_url: S.String,
	tags_url: S.String,
	teams_url: S.String,
	trees_url: S.String,
	clone_url: S.String,
	mirror_url: S.NullOr(S.String),
	hooks_url: S.String,
	svn_url: S.String,
	homepage: S.NullOr(S.String),
	language: S.NullOr(S.String),
	forks_count: S.Int,
	stargazers_count: S.Int,
	watchers_count: S.Int,
	/**
	 * The size of the repository, in kilobytes. Size is calculated hourly. When a repository is initially created, the size is 0.
	 */
	size: S.Int,
	/**
	 * The default branch of the repository.
	 */
	default_branch: S.String,
	open_issues_count: S.Int,
	/**
	 * Whether this repository acts as a template that can be used to generate new repositories.
	 */
	is_template: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	topics: S.optionalWith(S.Array(S.String), { nullable: true }),
	/**
	 * Whether issues are enabled.
	 */
	has_issues: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => true as const),
	),
	/**
	 * Whether projects are enabled.
	 */
	has_projects: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => true as const),
	),
	/**
	 * Whether the wiki is enabled.
	 */
	has_wiki: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => true as const),
	),
	has_pages: S.Boolean,
	/**
	 * Whether downloads are enabled.
	 */
	has_downloads: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => true as const),
	),
	/**
	 * Whether discussions are enabled.
	 */
	has_discussions: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	/**
	 * Whether pull requests are enabled.
	 */
	has_pull_requests: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => true as const,
	}),
	/**
	 * The policy controlling who can create pull requests: all or collaborators_only.
	 */
	pull_request_creation_policy: S.optionalWith(
		NullableRepositoryPullRequestCreationPolicy,
		{ nullable: true },
	),
	/**
	 * Whether the repository is archived.
	 */
	archived: S.Boolean.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => false as const),
	),
	/**
	 * Returns whether or not this repository disabled.
	 */
	disabled: S.Boolean,
	/**
	 * The repository visibility: public, private, or internal.
	 */
	visibility: S.optionalWith(S.String, {
		nullable: true,
		default: () => "public" as const,
	}),
	pushed_at: S.NullOr(S.String),
	created_at: S.NullOr(S.String),
	updated_at: S.NullOr(S.String),
	/**
	 * Whether to allow rebase merges for pull requests.
	 */
	allow_rebase_merge: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => true as const,
	}),
	temp_clone_token: S.optionalWith(S.String, { nullable: true }),
	/**
	 * Whether to allow squash merges for pull requests.
	 */
	allow_squash_merge: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => true as const,
	}),
	/**
	 * Whether to allow Auto-merge to be used on pull requests.
	 */
	allow_auto_merge: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	/**
	 * Whether to delete head branches when pull requests are merged
	 */
	delete_branch_on_merge: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	/**
	 * Whether or not a pull request head branch that is behind its base branch can always be updated even if it is not required to be up to date before merging.
	 */
	allow_update_branch: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	/**
	 * Whether a squash merge commit can use the pull request title as default. **This property is closing down. Please use `squash_merge_commit_title` instead.
	 */
	use_squash_pr_title_as_default: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	/**
	 * The default value for a squash merge commit title:
	 *
	 * - `PR_TITLE` - default to the pull request's title.
	 * - `COMMIT_OR_PR_TITLE` - default to the commit's title (if only one commit) or the pull request's title (when more than one commit).
	 */
	squash_merge_commit_title: S.optionalWith(
		NullableRepositorySquashMergeCommitTitle,
		{ nullable: true },
	),
	/**
	 * The default value for a squash merge commit message:
	 *
	 * - `PR_BODY` - default to the pull request's body.
	 * - `COMMIT_MESSAGES` - default to the branch's commit messages.
	 * - `BLANK` - default to a blank commit message.
	 */
	squash_merge_commit_message: S.optionalWith(
		NullableRepositorySquashMergeCommitMessage,
		{ nullable: true },
	),
	/**
	 * The default value for a merge commit title.
	 *
	 * - `PR_TITLE` - default to the pull request's title.
	 * - `MERGE_MESSAGE` - default to the classic title for a merge message (e.g., Merge pull request #123 from branch-name).
	 */
	merge_commit_title: S.optionalWith(NullableRepositoryMergeCommitTitle, {
		nullable: true,
	}),
	/**
	 * The default value for a merge commit message.
	 *
	 * - `PR_TITLE` - default to the pull request's title.
	 * - `PR_BODY` - default to the pull request's body.
	 * - `BLANK` - default to a blank commit message.
	 */
	merge_commit_message: S.optionalWith(NullableRepositoryMergeCommitMessage, {
		nullable: true,
	}),
	/**
	 * Whether to allow merge commits for pull requests.
	 */
	allow_merge_commit: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => true as const,
	}),
	/**
	 * Whether to allow forking this repo
	 */
	allow_forking: S.optionalWith(S.Boolean, { nullable: true }),
	/**
	 * Whether to require contributors to sign off on web-based commits
	 */
	web_commit_signoff_required: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	open_issues: S.Int,
	watchers: S.Int,
	master_branch: S.optionalWith(S.String, { nullable: true }),
	starred_at: S.optionalWith(S.String, { nullable: true }),
	/**
	 * Whether anonymous git access is enabled for this repository
	 */
	anonymous_access_enabled: S.optionalWith(S.Boolean, { nullable: true }),
	/**
	 * The status of the code search index for this repository
	 */
	code_search_index_status: S.optionalWith(
		S.Struct({
			lexical_search_ok: S.optionalWith(S.Boolean, { nullable: true }),
			lexical_commit_sha: S.optionalWith(S.String, { nullable: true }),
		}),
		{ nullable: true },
	),
}) {}

/**
 * The default value for a squash merge commit title:
 *
 * - `PR_TITLE` - default to the pull request's title.
 * - `COMMIT_OR_PR_TITLE` - default to the commit's title (if only one commit) or the pull request's title (when more than one commit).
 */
export class FullRepositorySquashMergeCommitTitle extends S.Literal(
	"PR_TITLE",
	"COMMIT_OR_PR_TITLE",
) {}

/**
 * The default value for a squash merge commit message:
 *
 * - `PR_BODY` - default to the pull request's body.
 * - `COMMIT_MESSAGES` - default to the branch's commit messages.
 * - `BLANK` - default to a blank commit message.
 */
export class FullRepositorySquashMergeCommitMessage extends S.Literal(
	"PR_BODY",
	"COMMIT_MESSAGES",
	"BLANK",
) {}

/**
 * The default value for a merge commit title.
 *
 *   - `PR_TITLE` - default to the pull request's title.
 *   - `MERGE_MESSAGE` - default to the classic title for a merge message (e.g., Merge pull request #123 from branch-name).
 */
export class FullRepositoryMergeCommitTitle extends S.Literal(
	"PR_TITLE",
	"MERGE_MESSAGE",
) {}

/**
 * The default value for a merge commit message.
 *
 * - `PR_TITLE` - default to the pull request's title.
 * - `PR_BODY` - default to the pull request's body.
 * - `BLANK` - default to a blank commit message.
 */
export class FullRepositoryMergeCommitMessage extends S.Literal(
	"PR_BODY",
	"PR_TITLE",
	"BLANK",
) {}

/**
 * A GitHub user.
 */
export class NullableSimpleUser extends S.Class<NullableSimpleUser>(
	"NullableSimpleUser",
)({
	name: S.optionalWith(S.String, { nullable: true }),
	email: S.optionalWith(S.String, { nullable: true }),
	login: S.String,
	id: S.Int,
	node_id: S.String,
	avatar_url: S.String,
	gravatar_id: S.NullOr(S.String),
	url: S.String,
	html_url: S.String,
	followers_url: S.String,
	following_url: S.String,
	gists_url: S.String,
	starred_url: S.String,
	subscriptions_url: S.String,
	organizations_url: S.String,
	repos_url: S.String,
	events_url: S.String,
	received_events_url: S.String,
	type: S.String,
	site_admin: S.Boolean,
	starred_at: S.optionalWith(S.String, { nullable: true }),
	user_view_type: S.optionalWith(S.String, { nullable: true }),
}) {}

/**
 * Code of Conduct Simple
 */
export class CodeOfConductSimple extends S.Class<CodeOfConductSimple>(
	"CodeOfConductSimple",
)({
	url: S.String,
	key: S.String,
	name: S.String,
	html_url: S.NullOr(S.String),
}) {}

export class SecurityAndAnalysisAdvancedSecurityStatus extends S.Literal(
	"enabled",
	"disabled",
) {}

export class SecurityAndAnalysisCodeSecurityStatus extends S.Literal(
	"enabled",
	"disabled",
) {}

/**
 * The enablement status of Dependabot security updates for the repository.
 */
export class SecurityAndAnalysisDependabotSecurityUpdatesStatus extends S.Literal(
	"enabled",
	"disabled",
) {}

export class SecurityAndAnalysisSecretScanningStatus extends S.Literal(
	"enabled",
	"disabled",
) {}

export class SecurityAndAnalysisSecretScanningPushProtectionStatus extends S.Literal(
	"enabled",
	"disabled",
) {}

export class SecurityAndAnalysisSecretScanningNonProviderPatternsStatus extends S.Literal(
	"enabled",
	"disabled",
) {}

export class SecurityAndAnalysisSecretScanningAiDetectionStatus extends S.Literal(
	"enabled",
	"disabled",
) {}

export class SecurityAndAnalysisSecretScanningDelegatedAlertDismissalStatus extends S.Literal(
	"enabled",
	"disabled",
) {}

export class SecurityAndAnalysisSecretScanningDelegatedBypassStatus extends S.Literal(
	"enabled",
	"disabled",
) {}

export class SecurityAndAnalysis extends S.Class<SecurityAndAnalysis>(
	"SecurityAndAnalysis",
)({
	/**
	 * Enable or disable GitHub Advanced Security for the repository.
	 *
	 * For standalone Code Scanning or Secret Protection products, this parameter cannot be used.
	 */
	advanced_security: S.optionalWith(
		S.Struct({
			status: S.optionalWith(SecurityAndAnalysisAdvancedSecurityStatus, {
				nullable: true,
			}),
		}),
		{ nullable: true },
	),
	code_security: S.optionalWith(
		S.Struct({
			status: S.optionalWith(SecurityAndAnalysisCodeSecurityStatus, {
				nullable: true,
			}),
		}),
		{ nullable: true },
	),
	/**
	 * Enable or disable Dependabot security updates for the repository.
	 */
	dependabot_security_updates: S.optionalWith(
		S.Struct({
			/**
			 * The enablement status of Dependabot security updates for the repository.
			 */
			status: S.optionalWith(
				SecurityAndAnalysisDependabotSecurityUpdatesStatus,
				{ nullable: true },
			),
		}),
		{ nullable: true },
	),
	secret_scanning: S.optionalWith(
		S.Struct({
			status: S.optionalWith(SecurityAndAnalysisSecretScanningStatus, {
				nullable: true,
			}),
		}),
		{ nullable: true },
	),
	secret_scanning_push_protection: S.optionalWith(
		S.Struct({
			status: S.optionalWith(
				SecurityAndAnalysisSecretScanningPushProtectionStatus,
				{ nullable: true },
			),
		}),
		{ nullable: true },
	),
	secret_scanning_non_provider_patterns: S.optionalWith(
		S.Struct({
			status: S.optionalWith(
				SecurityAndAnalysisSecretScanningNonProviderPatternsStatus,
				{ nullable: true },
			),
		}),
		{ nullable: true },
	),
	secret_scanning_ai_detection: S.optionalWith(
		S.Struct({
			status: S.optionalWith(
				SecurityAndAnalysisSecretScanningAiDetectionStatus,
				{ nullable: true },
			),
		}),
		{ nullable: true },
	),
	secret_scanning_delegated_alert_dismissal: S.optionalWith(
		S.Struct({
			status: S.optionalWith(
				SecurityAndAnalysisSecretScanningDelegatedAlertDismissalStatus,
				{ nullable: true },
			),
		}),
		{ nullable: true },
	),
	secret_scanning_delegated_bypass: S.optionalWith(
		S.Struct({
			status: S.optionalWith(
				SecurityAndAnalysisSecretScanningDelegatedBypassStatus,
				{ nullable: true },
			),
		}),
		{ nullable: true },
	),
	secret_scanning_delegated_bypass_options: S.optionalWith(
		S.Struct({
			/**
			 * The bypass reviewers for secret scanning delegated bypass
			 */
			reviewers: S.optionalWith(
				S.Array(
					S.Struct({
						/**
						 * The ID of the team or role selected as a bypass reviewer
						 */
						reviewer_id: S.Int,
						/**
						 * The type of the bypass reviewer
						 */
						reviewer_type: S.Literal("TEAM", "ROLE"),
					}),
				),
				{ nullable: true },
			),
		}),
		{ nullable: true },
	),
}) {}

/**
 * Full Repository
 */
export class FullRepository extends S.Class<FullRepository>("FullRepository")({
	id: S.Int,
	node_id: S.String,
	name: S.String,
	full_name: S.String,
	owner: SimpleUser,
	private: S.Boolean,
	html_url: S.String,
	description: S.NullOr(S.String),
	fork: S.Boolean,
	url: S.String,
	archive_url: S.String,
	assignees_url: S.String,
	blobs_url: S.String,
	branches_url: S.String,
	collaborators_url: S.String,
	comments_url: S.String,
	commits_url: S.String,
	compare_url: S.String,
	contents_url: S.String,
	contributors_url: S.String,
	deployments_url: S.String,
	downloads_url: S.String,
	events_url: S.String,
	forks_url: S.String,
	git_commits_url: S.String,
	git_refs_url: S.String,
	git_tags_url: S.String,
	git_url: S.String,
	issue_comment_url: S.String,
	issue_events_url: S.String,
	issues_url: S.String,
	keys_url: S.String,
	labels_url: S.String,
	languages_url: S.String,
	merges_url: S.String,
	milestones_url: S.String,
	notifications_url: S.String,
	pulls_url: S.String,
	releases_url: S.String,
	ssh_url: S.String,
	stargazers_url: S.String,
	statuses_url: S.String,
	subscribers_url: S.String,
	subscription_url: S.String,
	tags_url: S.String,
	teams_url: S.String,
	trees_url: S.String,
	clone_url: S.String,
	mirror_url: S.NullOr(S.String),
	hooks_url: S.String,
	svn_url: S.String,
	homepage: S.NullOr(S.String),
	language: S.NullOr(S.String),
	forks_count: S.Int,
	stargazers_count: S.Int,
	watchers_count: S.Int,
	/**
	 * The size of the repository, in kilobytes. Size is calculated hourly. When a repository is initially created, the size is 0.
	 */
	size: S.Int,
	default_branch: S.String,
	open_issues_count: S.Int,
	is_template: S.optionalWith(S.Boolean, { nullable: true }),
	topics: S.optionalWith(S.Array(S.String), { nullable: true }),
	has_issues: S.Boolean,
	has_projects: S.Boolean,
	has_wiki: S.Boolean,
	has_pages: S.Boolean,
	has_downloads: S.optionalWith(S.Boolean, { nullable: true }),
	has_discussions: S.Boolean,
	has_pull_requests: S.optionalWith(S.Boolean, { nullable: true }),
	/**
	 * The policy controlling who can create pull requests: all or collaborators_only.
	 */
	pull_request_creation_policy: S.optionalWith(
		FullRepositoryPullRequestCreationPolicy,
		{ nullable: true },
	),
	archived: S.Boolean,
	/**
	 * Returns whether or not this repository disabled.
	 */
	disabled: S.Boolean,
	/**
	 * The repository visibility: public, private, or internal.
	 */
	visibility: S.optionalWith(S.String, { nullable: true }),
	pushed_at: S.String,
	created_at: S.String,
	updated_at: S.String,
	permissions: S.optionalWith(
		S.Struct({
			admin: S.Boolean,
			maintain: S.optionalWith(S.Boolean, { nullable: true }),
			push: S.Boolean,
			triage: S.optionalWith(S.Boolean, { nullable: true }),
			pull: S.Boolean,
		}),
		{ nullable: true },
	),
	allow_rebase_merge: S.optionalWith(S.Boolean, { nullable: true }),
	template_repository: S.optionalWith(NullableRepository, { nullable: true }),
	temp_clone_token: S.optionalWith(S.String, { nullable: true }),
	allow_squash_merge: S.optionalWith(S.Boolean, { nullable: true }),
	allow_auto_merge: S.optionalWith(S.Boolean, { nullable: true }),
	delete_branch_on_merge: S.optionalWith(S.Boolean, { nullable: true }),
	allow_merge_commit: S.optionalWith(S.Boolean, { nullable: true }),
	allow_update_branch: S.optionalWith(S.Boolean, { nullable: true }),
	use_squash_pr_title_as_default: S.optionalWith(S.Boolean, { nullable: true }),
	/**
	 * The default value for a squash merge commit title:
	 *
	 * - `PR_TITLE` - default to the pull request's title.
	 * - `COMMIT_OR_PR_TITLE` - default to the commit's title (if only one commit) or the pull request's title (when more than one commit).
	 */
	squash_merge_commit_title: S.optionalWith(
		FullRepositorySquashMergeCommitTitle,
		{ nullable: true },
	),
	/**
	 * The default value for a squash merge commit message:
	 *
	 * - `PR_BODY` - default to the pull request's body.
	 * - `COMMIT_MESSAGES` - default to the branch's commit messages.
	 * - `BLANK` - default to a blank commit message.
	 */
	squash_merge_commit_message: S.optionalWith(
		FullRepositorySquashMergeCommitMessage,
		{ nullable: true },
	),
	/**
	 * The default value for a merge commit title.
	 *
	 *   - `PR_TITLE` - default to the pull request's title.
	 *   - `MERGE_MESSAGE` - default to the classic title for a merge message (e.g., Merge pull request #123 from branch-name).
	 */
	merge_commit_title: S.optionalWith(FullRepositoryMergeCommitTitle, {
		nullable: true,
	}),
	/**
	 * The default value for a merge commit message.
	 *
	 * - `PR_TITLE` - default to the pull request's title.
	 * - `PR_BODY` - default to the pull request's body.
	 * - `BLANK` - default to a blank commit message.
	 */
	merge_commit_message: S.optionalWith(FullRepositoryMergeCommitMessage, {
		nullable: true,
	}),
	allow_forking: S.optionalWith(S.Boolean, { nullable: true }),
	web_commit_signoff_required: S.optionalWith(S.Boolean, { nullable: true }),
	subscribers_count: S.Int,
	network_count: S.Int,
	license: S.NullOr(NullableLicenseSimple),
	organization: S.optionalWith(NullableSimpleUser, { nullable: true }),
	parent: S.optionalWith(Repository, { nullable: true }),
	source: S.optionalWith(Repository, { nullable: true }),
	forks: S.Int,
	master_branch: S.optionalWith(S.String, { nullable: true }),
	open_issues: S.Int,
	watchers: S.Int,
	/**
	 * Whether anonymous git access is allowed.
	 */
	anonymous_access_enabled: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => true as const,
	}),
	code_of_conduct: S.optionalWith(CodeOfConductSimple, { nullable: true }),
	security_and_analysis: S.optionalWith(SecurityAndAnalysis, {
		nullable: true,
	}),
	/**
	 * The custom properties that were defined for the repository. The keys are the custom property names, and the values are the corresponding custom property values.
	 */
	custom_properties: S.optionalWith(
		S.Record({ key: S.String, value: S.Unknown }),
		{ nullable: true },
	),
}) {}

export class ReposListBranchesParams extends S.Struct({
	protected: S.optionalWith(S.Boolean, { nullable: true }),
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
}) {}

/**
 * Protected Branch Required Status Check
 */
export class ProtectedBranchRequiredStatusCheck extends S.Class<ProtectedBranchRequiredStatusCheck>(
	"ProtectedBranchRequiredStatusCheck",
)({
	url: S.optionalWith(S.String, { nullable: true }),
	enforcement_level: S.optionalWith(S.String, { nullable: true }),
	contexts: S.Array(S.String),
	checks: S.Array(
		S.Struct({
			context: S.String,
			app_id: S.NullOr(S.Int),
		}),
	),
	contexts_url: S.optionalWith(S.String, { nullable: true }),
	strict: S.optionalWith(S.Boolean, { nullable: true }),
}) {}

/**
 * Protected Branch Admin Enforced
 */
export class ProtectedBranchAdminEnforced extends S.Class<ProtectedBranchAdminEnforced>(
	"ProtectedBranchAdminEnforced",
)({
	url: S.String,
	enabled: S.Boolean,
}) {}

/**
 * The ownership type of the team
 */
export class TeamType extends S.Literal("enterprise", "organization") {}

/**
 * The ownership type of the team
 */
export class NullableTeamSimpleType extends S.Literal(
	"enterprise",
	"organization",
) {}

/**
 * Groups of organization members that gives permissions on specified repositories.
 */
export class NullableTeamSimple extends S.Class<NullableTeamSimple>(
	"NullableTeamSimple",
)({
	/**
	 * Unique identifier of the team
	 */
	id: S.Int,
	node_id: S.String,
	/**
	 * URL for the team
	 */
	url: S.String,
	members_url: S.String,
	/**
	 * Name of the team
	 */
	name: S.String,
	/**
	 * Description of the team
	 */
	description: S.NullOr(S.String),
	/**
	 * Permission that the team will have for its repositories
	 */
	permission: S.String,
	/**
	 * The level of privacy this team should have
	 */
	privacy: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The notification setting the team has set
	 */
	notification_setting: S.optionalWith(S.String, { nullable: true }),
	html_url: S.String,
	repositories_url: S.String,
	slug: S.String,
	/**
	 * Distinguished Name (DN) that team maps to within LDAP environment
	 */
	ldap_dn: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The ownership type of the team
	 */
	type: NullableTeamSimpleType,
	/**
	 * Unique identifier of the organization to which this team belongs
	 */
	organization_id: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * Unique identifier of the enterprise to which this team belongs
	 */
	enterprise_id: S.optionalWith(S.Int, { nullable: true }),
}) {}

/**
 * Groups of organization members that gives permissions on specified repositories.
 */
export class Team extends S.Class<Team>("Team")({
	id: S.Int,
	node_id: S.String,
	name: S.String,
	slug: S.String,
	description: S.NullOr(S.String),
	privacy: S.optionalWith(S.String, { nullable: true }),
	notification_setting: S.optionalWith(S.String, { nullable: true }),
	permission: S.String,
	permissions: S.optionalWith(
		S.Struct({
			pull: S.Boolean,
			triage: S.Boolean,
			push: S.Boolean,
			maintain: S.Boolean,
			admin: S.Boolean,
		}),
		{ nullable: true },
	),
	url: S.String,
	html_url: S.String,
	members_url: S.String,
	repositories_url: S.String,
	/**
	 * The ownership type of the team
	 */
	type: TeamType,
	/**
	 * Unique identifier of the organization to which this team belongs
	 */
	organization_id: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * Unique identifier of the enterprise to which this team belongs
	 */
	enterprise_id: S.optionalWith(S.Int, { nullable: true }),
	parent: S.NullOr(NullableTeamSimple),
}) {}

/**
 * An enterprise on GitHub.
 */
export class Enterprise extends S.Class<Enterprise>("Enterprise")({
	/**
	 * A short description of the enterprise.
	 */
	description: S.optionalWith(S.String, { nullable: true }),
	html_url: S.String,
	/**
	 * The enterprise's website URL.
	 */
	website_url: S.optionalWith(S.String, { nullable: true }),
	/**
	 * Unique identifier of the enterprise
	 */
	id: S.Int,
	node_id: S.String,
	/**
	 * The name of the enterprise.
	 */
	name: S.String,
	/**
	 * The slug url identifier for the enterprise.
	 */
	slug: S.String,
	created_at: S.NullOr(S.String),
	updated_at: S.NullOr(S.String),
	avatar_url: S.String,
}) {}

/**
 * GitHub apps are a new way to extend GitHub. They can be installed directly on organizations and user accounts and granted access to specific repositories. They come with granular permissions and built-in webhooks. GitHub apps are first class actors within GitHub.
 */
export class Integration extends S.Class<Integration>("Integration")({
	/**
	 * Unique identifier of the GitHub app
	 */
	id: S.Int,
	/**
	 * The slug name of the GitHub app
	 */
	slug: S.optionalWith(S.String, { nullable: true }),
	node_id: S.String,
	client_id: S.optionalWith(S.String, { nullable: true }),
	owner: S.Union(SimpleUser, Enterprise),
	/**
	 * The name of the GitHub app
	 */
	name: S.String,
	description: S.NullOr(S.String),
	external_url: S.String,
	html_url: S.String,
	created_at: S.String,
	updated_at: S.String,
	/**
	 * The set of permissions for the GitHub app
	 */
	permissions: S.Struct({
		issues: S.optionalWith(S.String, { nullable: true }),
		checks: S.optionalWith(S.String, { nullable: true }),
		metadata: S.optionalWith(S.String, { nullable: true }),
		contents: S.optionalWith(S.String, { nullable: true }),
		deployments: S.optionalWith(S.String, { nullable: true }),
	}),
	/**
	 * The list of events for the GitHub app. Note that the `installation_target`, `security_advisory`, and `meta` events are not included because they are global events and not specific to an installation.
	 */
	events: S.Array(S.String),
	/**
	 * The number of installations associated with the GitHub app. Only returned when the integration is requesting details about itself.
	 */
	installations_count: S.optionalWith(S.Int, { nullable: true }),
}) {}

/**
 * Protected Branch Pull Request Review
 */
export class ProtectedBranchPullRequestReview extends S.Class<ProtectedBranchPullRequestReview>(
	"ProtectedBranchPullRequestReview",
)({
	url: S.optionalWith(S.String, { nullable: true }),
	dismissal_restrictions: S.optionalWith(
		S.Struct({
			/**
			 * The list of users with review dismissal access.
			 */
			users: S.optionalWith(S.Array(SimpleUser), { nullable: true }),
			/**
			 * The list of teams with review dismissal access.
			 */
			teams: S.optionalWith(S.Array(Team), { nullable: true }),
			/**
			 * The list of apps with review dismissal access.
			 */
			apps: S.optionalWith(S.Array(Integration), { nullable: true }),
			url: S.optionalWith(S.String, { nullable: true }),
			users_url: S.optionalWith(S.String, { nullable: true }),
			teams_url: S.optionalWith(S.String, { nullable: true }),
		}),
		{ nullable: true },
	),
	/**
	 * Allow specific users, teams, or apps to bypass pull request requirements.
	 */
	bypass_pull_request_allowances: S.optionalWith(
		S.Struct({
			/**
			 * The list of users allowed to bypass pull request requirements.
			 */
			users: S.optionalWith(S.Array(SimpleUser), { nullable: true }),
			/**
			 * The list of teams allowed to bypass pull request requirements.
			 */
			teams: S.optionalWith(S.Array(Team), { nullable: true }),
			/**
			 * The list of apps allowed to bypass pull request requirements.
			 */
			apps: S.optionalWith(S.Array(Integration), { nullable: true }),
		}),
		{ nullable: true },
	),
	dismiss_stale_reviews: S.Boolean,
	require_code_owner_reviews: S.Boolean,
	required_approving_review_count: S.optionalWith(
		S.Int.pipe(S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(6)),
		{ nullable: true },
	),
	/**
	 * Whether the most recent push must be approved by someone other than the person who pushed it.
	 */
	require_last_push_approval: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
}) {}

/**
 * Branch Restriction Policy
 */
export class BranchRestrictionPolicy extends S.Class<BranchRestrictionPolicy>(
	"BranchRestrictionPolicy",
)({
	url: S.String,
	users_url: S.String,
	teams_url: S.String,
	apps_url: S.String,
	users: S.Array(
		S.Struct({
			login: S.optionalWith(S.String, { nullable: true }),
			id: S.optionalWith(S.Int, { nullable: true }),
			node_id: S.optionalWith(S.String, { nullable: true }),
			avatar_url: S.optionalWith(S.String, { nullable: true }),
			gravatar_id: S.optionalWith(S.String, { nullable: true }),
			url: S.optionalWith(S.String, { nullable: true }),
			html_url: S.optionalWith(S.String, { nullable: true }),
			followers_url: S.optionalWith(S.String, { nullable: true }),
			following_url: S.optionalWith(S.String, { nullable: true }),
			gists_url: S.optionalWith(S.String, { nullable: true }),
			starred_url: S.optionalWith(S.String, { nullable: true }),
			subscriptions_url: S.optionalWith(S.String, { nullable: true }),
			organizations_url: S.optionalWith(S.String, { nullable: true }),
			repos_url: S.optionalWith(S.String, { nullable: true }),
			events_url: S.optionalWith(S.String, { nullable: true }),
			received_events_url: S.optionalWith(S.String, { nullable: true }),
			type: S.optionalWith(S.String, { nullable: true }),
			site_admin: S.optionalWith(S.Boolean, { nullable: true }),
			user_view_type: S.optionalWith(S.String, { nullable: true }),
		}),
	),
	teams: S.Array(Team),
	apps: S.Array(
		S.Struct({
			id: S.optionalWith(S.Int, { nullable: true }),
			slug: S.optionalWith(S.String, { nullable: true }),
			node_id: S.optionalWith(S.String, { nullable: true }),
			owner: S.optionalWith(
				S.Struct({
					login: S.optionalWith(S.String, { nullable: true }),
					id: S.optionalWith(S.Int, { nullable: true }),
					node_id: S.optionalWith(S.String, { nullable: true }),
					url: S.optionalWith(S.String, { nullable: true }),
					repos_url: S.optionalWith(S.String, { nullable: true }),
					events_url: S.optionalWith(S.String, { nullable: true }),
					hooks_url: S.optionalWith(S.String, { nullable: true }),
					issues_url: S.optionalWith(S.String, { nullable: true }),
					members_url: S.optionalWith(S.String, { nullable: true }),
					public_members_url: S.optionalWith(S.String, { nullable: true }),
					avatar_url: S.optionalWith(S.String, { nullable: true }),
					description: S.optionalWith(S.String, { nullable: true }),
					gravatar_id: S.optionalWith(S.String, { nullable: true }),
					html_url: S.optionalWith(S.String, { nullable: true }),
					followers_url: S.optionalWith(S.String, { nullable: true }),
					following_url: S.optionalWith(S.String, { nullable: true }),
					gists_url: S.optionalWith(S.String, { nullable: true }),
					starred_url: S.optionalWith(S.String, { nullable: true }),
					subscriptions_url: S.optionalWith(S.String, { nullable: true }),
					organizations_url: S.optionalWith(S.String, { nullable: true }),
					received_events_url: S.optionalWith(S.String, { nullable: true }),
					type: S.optionalWith(S.String, { nullable: true }),
					site_admin: S.optionalWith(S.Boolean, { nullable: true }),
					user_view_type: S.optionalWith(S.String, { nullable: true }),
				}),
				{ nullable: true },
			),
			name: S.optionalWith(S.String, { nullable: true }),
			client_id: S.optionalWith(S.String, { nullable: true }),
			description: S.optionalWith(S.String, { nullable: true }),
			external_url: S.optionalWith(S.String, { nullable: true }),
			html_url: S.optionalWith(S.String, { nullable: true }),
			created_at: S.optionalWith(S.String, { nullable: true }),
			updated_at: S.optionalWith(S.String, { nullable: true }),
			permissions: S.optionalWith(
				S.Struct({
					metadata: S.optionalWith(S.String, { nullable: true }),
					contents: S.optionalWith(S.String, { nullable: true }),
					issues: S.optionalWith(S.String, { nullable: true }),
					single_file: S.optionalWith(S.String, { nullable: true }),
				}),
				{ nullable: true },
			),
			events: S.optionalWith(S.Array(S.String), { nullable: true }),
		}),
	),
}) {}

/**
 * Branch Protection
 */
export class BranchProtection extends S.Class<BranchProtection>(
	"BranchProtection",
)({
	url: S.optionalWith(S.String, { nullable: true }),
	enabled: S.optionalWith(S.Boolean, { nullable: true }),
	required_status_checks: S.optionalWith(ProtectedBranchRequiredStatusCheck, {
		nullable: true,
	}),
	enforce_admins: S.optionalWith(ProtectedBranchAdminEnforced, {
		nullable: true,
	}),
	required_pull_request_reviews: S.optionalWith(
		ProtectedBranchPullRequestReview,
		{ nullable: true },
	),
	restrictions: S.optionalWith(BranchRestrictionPolicy, { nullable: true }),
	required_linear_history: S.optionalWith(
		S.Struct({
			enabled: S.optionalWith(S.Boolean, { nullable: true }),
		}),
		{ nullable: true },
	),
	allow_force_pushes: S.optionalWith(
		S.Struct({
			enabled: S.optionalWith(S.Boolean, { nullable: true }),
		}),
		{ nullable: true },
	),
	allow_deletions: S.optionalWith(
		S.Struct({
			enabled: S.optionalWith(S.Boolean, { nullable: true }),
		}),
		{ nullable: true },
	),
	block_creations: S.optionalWith(
		S.Struct({
			enabled: S.optionalWith(S.Boolean, { nullable: true }),
		}),
		{ nullable: true },
	),
	required_conversation_resolution: S.optionalWith(
		S.Struct({
			enabled: S.optionalWith(S.Boolean, { nullable: true }),
		}),
		{ nullable: true },
	),
	name: S.optionalWith(S.String, { nullable: true }),
	protection_url: S.optionalWith(S.String, { nullable: true }),
	required_signatures: S.optionalWith(
		S.Struct({
			url: S.String,
			enabled: S.Boolean,
		}),
		{ nullable: true },
	),
	/**
	 * Whether to set the branch as read-only. If this is true, users will not be able to push to the branch.
	 */
	lock_branch: S.optionalWith(
		S.Struct({
			enabled: S.optionalWith(S.Boolean, {
				nullable: true,
				default: () => false as const,
			}),
		}),
		{ nullable: true },
	),
	/**
	 * Whether users can pull changes from upstream when the branch is locked. Set to `true` to allow fork syncing. Set to `false` to prevent fork syncing.
	 */
	allow_fork_syncing: S.optionalWith(
		S.Struct({
			enabled: S.optionalWith(S.Boolean, {
				nullable: true,
				default: () => false as const,
			}),
		}),
		{ nullable: true },
	),
}) {}

/**
 * Short Branch
 */
export class ShortBranch extends S.Class<ShortBranch>("ShortBranch")({
	name: S.String,
	commit: S.Struct({
		sha: S.String,
		url: S.String,
	}),
	protected: S.Boolean,
	protection: S.optionalWith(BranchProtection, { nullable: true }),
	protection_url: S.optionalWith(S.String, { nullable: true }),
}) {}

export class ReposListBranches200 extends S.Array(ShortBranch) {}

export class PullsListParamsState extends S.Literal("open", "closed", "all") {}

export class PullsListParamsSort extends S.Literal(
	"created",
	"updated",
	"popularity",
	"long-running",
) {}

export class PullsListParamsDirection extends S.Literal("asc", "desc") {}

export class PullsListParams extends S.Struct({
	state: S.optionalWith(PullsListParamsState, {
		nullable: true,
		default: () => "open" as const,
	}),
	head: S.optionalWith(S.String, { nullable: true }),
	base: S.optionalWith(S.String, { nullable: true }),
	sort: S.optionalWith(PullsListParamsSort, {
		nullable: true,
		default: () => "created" as const,
	}),
	direction: S.optionalWith(PullsListParamsDirection, { nullable: true }),
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
}) {}

/**
 * The state of the milestone.
 */
export class NullableMilestoneState extends S.Literal("open", "closed") {}

/**
 * A collection of related issues and pull requests.
 */
export class NullableMilestone extends S.Class<NullableMilestone>(
	"NullableMilestone",
)({
	url: S.String,
	html_url: S.String,
	labels_url: S.String,
	id: S.Int,
	node_id: S.String,
	/**
	 * The number of the milestone.
	 */
	number: S.Int,
	/**
	 * The state of the milestone.
	 */
	state: NullableMilestoneState.pipe(
		S.propertySignature,
		S.withConstructorDefault(() => "open" as const),
	),
	/**
	 * The title of the milestone.
	 */
	title: S.String,
	description: S.NullOr(S.String),
	creator: S.NullOr(NullableSimpleUser),
	open_issues: S.Int,
	closed_issues: S.Int,
	created_at: S.String,
	updated_at: S.String,
	closed_at: S.NullOr(S.String),
	due_on: S.NullOr(S.String),
}) {}

/**
 * Hypermedia Link
 */
export class Link extends S.Class<Link>("Link")({
	href: S.String,
}) {}

/**
 * How the author is associated with the repository.
 */
export class AuthorAssociation extends S.Literal(
	"COLLABORATOR",
	"CONTRIBUTOR",
	"FIRST_TIMER",
	"FIRST_TIME_CONTRIBUTOR",
	"MANNEQUIN",
	"MEMBER",
	"NONE",
	"OWNER",
) {}

/**
 * The merge method to use.
 */
export class AutoMergeMergeMethod extends S.Literal(
	"merge",
	"squash",
	"rebase",
) {}

/**
 * The status of auto merging a pull request.
 */
export class AutoMerge extends S.Class<AutoMerge>("AutoMerge")({
	enabled_by: SimpleUser,
	/**
	 * The merge method to use.
	 */
	merge_method: AutoMergeMergeMethod,
	/**
	 * Title for the merge commit message.
	 */
	commit_title: S.String,
	/**
	 * Commit message for the merge commit.
	 */
	commit_message: S.String,
}) {}

/**
 * Pull Request Simple
 */
export class PullRequestSimple extends S.Class<PullRequestSimple>(
	"PullRequestSimple",
)({
	url: S.String,
	id: S.Int,
	node_id: S.String,
	html_url: S.String,
	diff_url: S.String,
	patch_url: S.String,
	issue_url: S.String,
	commits_url: S.String,
	review_comments_url: S.String,
	review_comment_url: S.String,
	comments_url: S.String,
	statuses_url: S.String,
	number: S.Int,
	state: S.String,
	locked: S.Boolean,
	title: S.String,
	user: S.NullOr(NullableSimpleUser),
	body: S.NullOr(S.String),
	labels: S.Array(
		S.Struct({
			id: S.Int,
			node_id: S.String,
			url: S.String,
			name: S.String,
			description: S.String,
			color: S.String,
			default: S.Boolean,
		}),
	),
	milestone: S.NullOr(NullableMilestone),
	active_lock_reason: S.optionalWith(S.String, { nullable: true }),
	created_at: S.String,
	updated_at: S.String,
	closed_at: S.NullOr(S.String),
	merged_at: S.NullOr(S.String),
	merge_commit_sha: S.NullOr(S.String),
	assignee: S.NullOr(NullableSimpleUser),
	assignees: S.optionalWith(S.Array(SimpleUser), { nullable: true }),
	requested_reviewers: S.optionalWith(S.Array(SimpleUser), { nullable: true }),
	requested_teams: S.optionalWith(S.Array(Team), { nullable: true }),
	head: S.Struct({
		label: S.String,
		ref: S.String,
		repo: Repository,
		sha: S.String,
		user: S.NullOr(NullableSimpleUser),
	}),
	base: S.Struct({
		label: S.String,
		ref: S.String,
		repo: Repository,
		sha: S.String,
		user: S.NullOr(NullableSimpleUser),
	}),
	_links: S.Struct({
		comments: Link,
		commits: Link,
		statuses: Link,
		html: Link,
		issue: Link,
		review_comments: Link,
		review_comment: Link,
		self: Link,
	}),
	author_association: AuthorAssociation,
	auto_merge: S.NullOr(AutoMerge),
	/**
	 * Indicates whether or not the pull request is a draft.
	 */
	draft: S.optionalWith(S.Boolean, { nullable: true }),
}) {}

export class PullsList200 extends S.Array(PullRequestSimple) {}

export class PullsGetParams extends S.Struct({}) {}

/**
 * State of this Pull Request. Either `open` or `closed`.
 */
export class PullRequestState extends S.Literal("open", "closed") {}

/**
 * The ownership type of the team
 */
export class TeamSimpleType extends S.Literal("enterprise", "organization") {}

/**
 * Groups of organization members that gives permissions on specified repositories.
 */
export class TeamSimple extends S.Class<TeamSimple>("TeamSimple")({
	/**
	 * Unique identifier of the team
	 */
	id: S.Int,
	node_id: S.String,
	/**
	 * URL for the team
	 */
	url: S.String,
	members_url: S.String,
	/**
	 * Name of the team
	 */
	name: S.String,
	/**
	 * Description of the team
	 */
	description: S.NullOr(S.String),
	/**
	 * Permission that the team will have for its repositories
	 */
	permission: S.String,
	/**
	 * The level of privacy this team should have
	 */
	privacy: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The notification setting the team has set
	 */
	notification_setting: S.optionalWith(S.String, { nullable: true }),
	html_url: S.String,
	repositories_url: S.String,
	slug: S.String,
	/**
	 * Distinguished Name (DN) that team maps to within LDAP environment
	 */
	ldap_dn: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The ownership type of the team
	 */
	type: TeamSimpleType,
	/**
	 * Unique identifier of the organization to which this team belongs
	 */
	organization_id: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * Unique identifier of the enterprise to which this team belongs
	 */
	enterprise_id: S.optionalWith(S.Int, { nullable: true }),
}) {}

/**
 * Pull requests let you tell others about changes you've pushed to a repository on GitHub. Once a pull request is sent, interested parties can review the set of changes, discuss potential modifications, and even push follow-up commits if necessary.
 */
export class PullRequest extends S.Class<PullRequest>("PullRequest")({
	url: S.String,
	id: S.Int,
	node_id: S.String,
	html_url: S.String,
	diff_url: S.String,
	patch_url: S.String,
	issue_url: S.String,
	commits_url: S.String,
	review_comments_url: S.String,
	review_comment_url: S.String,
	comments_url: S.String,
	statuses_url: S.String,
	/**
	 * Number uniquely identifying the pull request within its repository.
	 */
	number: S.Int,
	/**
	 * State of this Pull Request. Either `open` or `closed`.
	 */
	state: PullRequestState,
	locked: S.Boolean,
	/**
	 * The title of the pull request.
	 */
	title: S.String,
	user: SimpleUser,
	body: S.NullOr(S.String),
	labels: S.Array(
		S.Struct({
			id: S.Int,
			node_id: S.String,
			url: S.String,
			name: S.String,
			description: S.NullOr(S.String),
			color: S.String,
			default: S.Boolean,
		}),
	),
	milestone: S.NullOr(NullableMilestone),
	active_lock_reason: S.optionalWith(S.String, { nullable: true }),
	created_at: S.String,
	updated_at: S.String,
	closed_at: S.NullOr(S.String),
	merged_at: S.NullOr(S.String),
	merge_commit_sha: S.NullOr(S.String),
	assignee: S.NullOr(NullableSimpleUser),
	assignees: S.optionalWith(S.Array(SimpleUser), { nullable: true }),
	requested_reviewers: S.optionalWith(S.Array(SimpleUser), { nullable: true }),
	requested_teams: S.optionalWith(S.Array(TeamSimple), { nullable: true }),
	head: S.Struct({
		label: S.String,
		ref: S.String,
		repo: Repository,
		sha: S.String,
		user: SimpleUser,
	}),
	base: S.Struct({
		label: S.String,
		ref: S.String,
		repo: Repository,
		sha: S.String,
		user: SimpleUser,
	}),
	_links: S.Struct({
		comments: Link,
		commits: Link,
		statuses: Link,
		html: Link,
		issue: Link,
		review_comments: Link,
		review_comment: Link,
		self: Link,
	}),
	author_association: AuthorAssociation,
	auto_merge: S.NullOr(AutoMerge),
	/**
	 * Indicates whether or not the pull request is a draft.
	 */
	draft: S.optionalWith(S.Boolean, { nullable: true }),
	merged: S.Boolean,
	mergeable: S.NullOr(S.Boolean),
	rebaseable: S.optionalWith(S.Boolean, { nullable: true }),
	mergeable_state: S.String,
	merged_by: S.NullOr(NullableSimpleUser),
	comments: S.Int,
	review_comments: S.Int,
	/**
	 * Indicates whether maintainers can modify the pull request.
	 */
	maintainer_can_modify: S.Boolean,
	commits: S.Int,
	additions: S.Int,
	deletions: S.Int,
	changed_files: S.Int,
}) {}

export class PullsGet503 extends S.Struct({
	code: S.optionalWith(S.String, { nullable: true }),
	message: S.optionalWith(S.String, { nullable: true }),
	documentation_url: S.optionalWith(S.String, { nullable: true }),
}) {}

export class PullsMergeParams extends S.Struct({}) {}

/**
 * The merge method to use.
 */
export class PullsMergeRequestMergeMethod extends S.Literal(
	"merge",
	"squash",
	"rebase",
) {}

export class PullsMergeRequest extends S.Class<PullsMergeRequest>(
	"PullsMergeRequest",
)({
	/**
	 * Title for the automatic commit message.
	 */
	commit_title: S.optionalWith(S.String, { nullable: true }),
	/**
	 * Extra detail to append to automatic commit message.
	 */
	commit_message: S.optionalWith(S.String, { nullable: true }),
	/**
	 * SHA that pull request head must match to allow merge.
	 */
	sha: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The merge method to use.
	 */
	merge_method: S.optionalWith(PullsMergeRequestMergeMethod, {
		nullable: true,
	}),
}) {}

/**
 * Pull Request Merge Result
 */
export class PullRequestMergeResult extends S.Class<PullRequestMergeResult>(
	"PullRequestMergeResult",
)({
	sha: S.String,
	merged: S.Boolean,
	message: S.String,
}) {}

export class PullsMerge405 extends S.Struct({
	message: S.optionalWith(S.String, { nullable: true }),
	documentation_url: S.optionalWith(S.String, { nullable: true }),
}) {}

export class PullsMerge409 extends S.Struct({
	message: S.optionalWith(S.String, { nullable: true }),
	documentation_url: S.optionalWith(S.String, { nullable: true }),
}) {}

export class PullsListReviewsParams extends S.Struct({
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
}) {}

/**
 * Pull Request Reviews are reviews on pull requests.
 */
export class PullRequestReview extends S.Class<PullRequestReview>(
	"PullRequestReview",
)({
	/**
	 * Unique identifier of the review
	 */
	id: S.Int,
	node_id: S.String,
	user: S.NullOr(NullableSimpleUser),
	/**
	 * The text of the review.
	 */
	body: S.String,
	state: S.String,
	html_url: S.String,
	pull_request_url: S.String,
	_links: S.Struct({
		html: S.Struct({
			href: S.String,
		}),
		pull_request: S.Struct({
			href: S.String,
		}),
	}),
	submitted_at: S.optionalWith(S.String, { nullable: true }),
	/**
	 * A commit SHA for the review. If the commit object was garbage collected or forcibly deleted, then it no longer exists in Git and this value will be `null`.
	 */
	commit_id: S.NullOr(S.String),
	body_html: S.optionalWith(S.String, { nullable: true }),
	body_text: S.optionalWith(S.String, { nullable: true }),
	author_association: AuthorAssociation,
}) {}

export class PullsListReviews200 extends S.Array(PullRequestReview) {}

export class PullsCreateReviewParams extends S.Struct({}) {}

/**
 * The review action you want to perform. The review actions include: `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`. By leaving this blank, you set the review action state to `PENDING`, which means you will need to [submit the pull request review](https://docs.github.com/rest/pulls/reviews#submit-a-review-for-a-pull-request) when you are ready.
 */
export class PullsCreateReviewRequestEvent extends S.Literal(
	"APPROVE",
	"REQUEST_CHANGES",
	"COMMENT",
) {}

export class PullsCreateReviewRequest extends S.Class<PullsCreateReviewRequest>(
	"PullsCreateReviewRequest",
)({
	/**
	 * The SHA of the commit that needs a review. Not using the latest commit SHA may render your review comment outdated if a subsequent commit modifies the line you specify as the `position`. Defaults to the most recent commit in the pull request when you do not specify a value.
	 */
	commit_id: S.optionalWith(S.String, { nullable: true }),
	/**
	 * **Required** when using `REQUEST_CHANGES` or `COMMENT` for the `event` parameter. The body text of the pull request review.
	 */
	body: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The review action you want to perform. The review actions include: `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`. By leaving this blank, you set the review action state to `PENDING`, which means you will need to [submit the pull request review](https://docs.github.com/rest/pulls/reviews#submit-a-review-for-a-pull-request) when you are ready.
	 */
	event: S.optionalWith(PullsCreateReviewRequestEvent, { nullable: true }),
	/**
	 * Use the following table to specify the location, destination, and contents of the draft review comment.
	 */
	comments: S.optionalWith(
		S.Array(
			S.Struct({
				/**
				 * The relative path to the file that necessitates a review comment.
				 */
				path: S.String,
				/**
				 * The position in the diff where you want to add a review comment. Note this value is not the same as the line number in the file. The `position` value equals the number of lines down from the first "@@" hunk header in the file you want to add a comment. The line just below the "@@" line is position 1, the next line is position 2, and so on. The position in the diff continues to increase through lines of whitespace and additional hunks until the beginning of a new file.
				 */
				position: S.optionalWith(S.Int, { nullable: true }),
				/**
				 * Text of the review comment.
				 */
				body: S.String,
				line: S.optionalWith(S.Int, { nullable: true }),
				side: S.optionalWith(S.String, { nullable: true }),
				start_line: S.optionalWith(S.Int, { nullable: true }),
				start_side: S.optionalWith(S.String, { nullable: true }),
			}),
		),
		{ nullable: true },
	),
}) {}

/**
 * Validation Error Simple
 */
export class ValidationErrorSimple extends S.Class<ValidationErrorSimple>(
	"ValidationErrorSimple",
)({
	message: S.String,
	documentation_url: S.String,
	errors: S.optionalWith(S.Array(S.String), { nullable: true }),
}) {}

export class PullsListReviewCommentsParamsSort extends S.Literal(
	"created",
	"updated",
) {}

export class PullsListReviewCommentsParamsDirection extends S.Literal(
	"asc",
	"desc",
) {}

export class PullsListReviewCommentsParams extends S.Struct({
	sort: S.optionalWith(PullsListReviewCommentsParamsSort, {
		nullable: true,
		default: () => "created" as const,
	}),
	direction: S.optionalWith(PullsListReviewCommentsParamsDirection, {
		nullable: true,
	}),
	since: S.optionalWith(S.String, { nullable: true }),
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
}) {}

/**
 * The side of the first line of the range for a multi-line comment.
 */
export class PullRequestReviewCommentStartSide extends S.Literal(
	"LEFT",
	"RIGHT",
) {}

/**
 * The side of the diff to which the comment applies. The side of the last line of the range for a multi-line comment
 */
export class PullRequestReviewCommentSide extends S.Literal("LEFT", "RIGHT") {}

/**
 * The level at which the comment is targeted, can be a diff line or a file.
 */
export class PullRequestReviewCommentSubjectType extends S.Literal(
	"line",
	"file",
) {}

export class ReactionRollup extends S.Class<ReactionRollup>("ReactionRollup")({
	url: S.String,
	total_count: S.Int,
	"+1": S.Int,
	"-1": S.Int,
	laugh: S.Int,
	confused: S.Int,
	heart: S.Int,
	hooray: S.Int,
	eyes: S.Int,
	rocket: S.Int,
}) {}

/**
 * Pull Request Review Comments are comments on a portion of the Pull Request's diff.
 */
export class PullRequestReviewComment extends S.Class<PullRequestReviewComment>(
	"PullRequestReviewComment",
)({
	/**
	 * URL for the pull request review comment
	 */
	url: S.String,
	/**
	 * The ID of the pull request review to which the comment belongs.
	 */
	pull_request_review_id: S.NullOr(S.Int),
	/**
	 * The ID of the pull request review comment.
	 */
	id: S.Int,
	/**
	 * The node ID of the pull request review comment.
	 */
	node_id: S.String,
	/**
	 * The diff of the line that the comment refers to.
	 */
	diff_hunk: S.String,
	/**
	 * The relative path of the file to which the comment applies.
	 */
	path: S.String,
	/**
	 * The line index in the diff to which the comment applies. This field is closing down; use `line` instead.
	 */
	position: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * The index of the original line in the diff to which the comment applies. This field is closing down; use `original_line` instead.
	 */
	original_position: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * The SHA of the commit to which the comment applies.
	 */
	commit_id: S.String,
	/**
	 * The SHA of the original commit to which the comment applies.
	 */
	original_commit_id: S.String,
	/**
	 * The comment ID to reply to.
	 */
	in_reply_to_id: S.optionalWith(S.Int, { nullable: true }),
	user: S.NullOr(NullableSimpleUser),
	/**
	 * The text of the comment.
	 */
	body: S.String,
	created_at: S.String,
	updated_at: S.String,
	/**
	 * HTML URL for the pull request review comment.
	 */
	html_url: S.String,
	/**
	 * URL for the pull request that the review comment belongs to.
	 */
	pull_request_url: S.String,
	author_association: AuthorAssociation,
	_links: S.Struct({
		self: S.Struct({
			href: S.String,
		}),
		html: S.Struct({
			href: S.String,
		}),
		pull_request: S.Struct({
			href: S.String,
		}),
	}),
	/**
	 * The first line of the range for a multi-line comment.
	 */
	start_line: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * The first line of the range for a multi-line comment.
	 */
	original_start_line: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * The side of the first line of the range for a multi-line comment.
	 */
	start_side: S.optionalWith(PullRequestReviewCommentStartSide, {
		nullable: true,
		default: () => "RIGHT" as const,
	}),
	/**
	 * The line of the blob to which the comment applies. The last line of the range for a multi-line comment
	 */
	line: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * The line of the blob to which the comment applies. The last line of the range for a multi-line comment
	 */
	original_line: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * The side of the diff to which the comment applies. The side of the last line of the range for a multi-line comment
	 */
	side: S.optionalWith(PullRequestReviewCommentSide, {
		nullable: true,
		default: () => "RIGHT" as const,
	}),
	/**
	 * The level at which the comment is targeted, can be a diff line or a file.
	 */
	subject_type: S.optionalWith(PullRequestReviewCommentSubjectType, {
		nullable: true,
	}),
	reactions: S.optionalWith(ReactionRollup, { nullable: true }),
	body_html: S.optionalWith(S.String, { nullable: true }),
	body_text: S.optionalWith(S.String, { nullable: true }),
}) {}

export class PullsListReviewComments200 extends S.Array(
	PullRequestReviewComment,
) {}

export class PullsListFilesParams extends S.Struct({
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
}) {}

export class DiffEntryStatus extends S.Literal(
	"added",
	"removed",
	"modified",
	"renamed",
	"copied",
	"changed",
	"unchanged",
) {}

/**
 * Diff Entry
 */
export class DiffEntry extends S.Class<DiffEntry>("DiffEntry")({
	sha: S.NullOr(S.String),
	filename: S.String,
	status: DiffEntryStatus,
	additions: S.Int,
	deletions: S.Int,
	changes: S.Int,
	blob_url: S.String,
	raw_url: S.String,
	contents_url: S.String,
	patch: S.optionalWith(S.String, { nullable: true }),
	previous_filename: S.optionalWith(S.String, { nullable: true }),
}) {}

export class PullsListFiles200 extends S.Array(DiffEntry) {}

export class PullsListFiles503 extends S.Struct({
	code: S.optionalWith(S.String, { nullable: true }),
	message: S.optionalWith(S.String, { nullable: true }),
	documentation_url: S.optionalWith(S.String, { nullable: true }),
}) {}

export class IssuesListForRepoParamsState extends S.Literal(
	"open",
	"closed",
	"all",
) {}

export class IssuesListForRepoParamsSort extends S.Literal(
	"created",
	"updated",
	"comments",
) {}

export class IssuesListForRepoParamsDirection extends S.Literal(
	"asc",
	"desc",
) {}

export class IssuesListForRepoParams extends S.Struct({
	milestone: S.optionalWith(S.String, { nullable: true }),
	state: S.optionalWith(IssuesListForRepoParamsState, {
		nullable: true,
		default: () => "open" as const,
	}),
	assignee: S.optionalWith(S.String, { nullable: true }),
	type: S.optionalWith(S.String, { nullable: true }),
	creator: S.optionalWith(S.String, { nullable: true }),
	mentioned: S.optionalWith(S.String, { nullable: true }),
	labels: S.optionalWith(S.String, { nullable: true }),
	sort: S.optionalWith(IssuesListForRepoParamsSort, {
		nullable: true,
		default: () => "created" as const,
	}),
	direction: S.optionalWith(IssuesListForRepoParamsDirection, {
		nullable: true,
		default: () => "desc" as const,
	}),
	since: S.optionalWith(S.String, { nullable: true }),
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
}) {}

/**
 * The reason for the current state
 */
export class IssueStateReason extends S.Literal(
	"completed",
	"reopened",
	"not_planned",
	"duplicate",
) {}

/**
 * The color of the issue type.
 */
export class IssueTypeColor extends S.Literal(
	"gray",
	"blue",
	"green",
	"yellow",
	"orange",
	"red",
	"pink",
	"purple",
) {}

/**
 * The type of issue.
 */
export class IssueType extends S.Class<IssueType>("IssueType")({
	/**
	 * The unique identifier of the issue type.
	 */
	id: S.Int,
	/**
	 * The node identifier of the issue type.
	 */
	node_id: S.String,
	/**
	 * The name of the issue type.
	 */
	name: S.String,
	/**
	 * The description of the issue type.
	 */
	description: S.NullOr(S.String),
	/**
	 * The color of the issue type.
	 */
	color: S.optionalWith(IssueTypeColor, { nullable: true }),
	/**
	 * The time the issue type created.
	 */
	created_at: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The time the issue type last updated.
	 */
	updated_at: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The enabled state of the issue type.
	 */
	is_enabled: S.optionalWith(S.Boolean, { nullable: true }),
}) {}

/**
 * GitHub apps are a new way to extend GitHub. They can be installed directly on organizations and user accounts and granted access to specific repositories. They come with granular permissions and built-in webhooks. GitHub apps are first class actors within GitHub.
 */
export class NullableIntegration extends S.Class<NullableIntegration>(
	"NullableIntegration",
)({
	/**
	 * Unique identifier of the GitHub app
	 */
	id: S.Int,
	/**
	 * The slug name of the GitHub app
	 */
	slug: S.optionalWith(S.String, { nullable: true }),
	node_id: S.String,
	client_id: S.optionalWith(S.String, { nullable: true }),
	owner: S.Union(SimpleUser, Enterprise),
	/**
	 * The name of the GitHub app
	 */
	name: S.String,
	description: S.NullOr(S.String),
	external_url: S.String,
	html_url: S.String,
	created_at: S.String,
	updated_at: S.String,
	/**
	 * The set of permissions for the GitHub app
	 */
	permissions: S.Struct({
		issues: S.optionalWith(S.String, { nullable: true }),
		checks: S.optionalWith(S.String, { nullable: true }),
		metadata: S.optionalWith(S.String, { nullable: true }),
		contents: S.optionalWith(S.String, { nullable: true }),
		deployments: S.optionalWith(S.String, { nullable: true }),
	}),
	/**
	 * The list of events for the GitHub app. Note that the `installation_target`, `security_advisory`, and `meta` events are not included because they are global events and not specific to an installation.
	 */
	events: S.Array(S.String),
	/**
	 * The number of installations associated with the GitHub app. Only returned when the integration is requesting details about itself.
	 */
	installations_count: S.optionalWith(S.Int, { nullable: true }),
}) {}

export class SubIssuesSummary extends S.Class<SubIssuesSummary>(
	"SubIssuesSummary",
)({
	total: S.Int,
	completed: S.Int,
	percent_completed: S.Int,
}) {}

/**
 * Context around who pinned an issue comment and when it was pinned.
 */
export class NullablePinnedIssueComment extends S.Class<NullablePinnedIssueComment>(
	"NullablePinnedIssueComment",
)({
	pinned_at: S.String,
	pinned_by: S.NullOr(NullableSimpleUser),
}) {}

/**
 * Comments provide a way for people to collaborate on an issue.
 */
export class NullableIssueComment extends S.Class<NullableIssueComment>(
	"NullableIssueComment",
)({
	/**
	 * Unique identifier of the issue comment
	 */
	id: S.Int,
	node_id: S.String,
	/**
	 * URL for the issue comment
	 */
	url: S.String,
	/**
	 * Contents of the issue comment
	 */
	body: S.optionalWith(S.String, { nullable: true }),
	body_text: S.optionalWith(S.String, { nullable: true }),
	body_html: S.optionalWith(S.String, { nullable: true }),
	html_url: S.String,
	user: S.NullOr(NullableSimpleUser),
	created_at: S.String,
	updated_at: S.String,
	issue_url: S.String,
	author_association: S.optionalWith(AuthorAssociation, { nullable: true }),
	performed_via_github_app: S.optionalWith(NullableIntegration, {
		nullable: true,
	}),
	reactions: S.optionalWith(ReactionRollup, { nullable: true }),
	pin: S.optionalWith(NullablePinnedIssueComment, { nullable: true }),
}) {}

export class IssueDependenciesSummary extends S.Class<IssueDependenciesSummary>(
	"IssueDependenciesSummary",
)({
	blocked_by: S.Int,
	blocking: S.Int,
	total_blocked_by: S.Int,
	total_blocking: S.Int,
}) {}

/**
 * The data type of the issue field
 */
export class IssueFieldValueDataType extends S.Literal(
	"text",
	"single_select",
	"number",
	"date",
) {}

/**
 * A value assigned to an issue field
 */
export class IssueFieldValue extends S.Class<IssueFieldValue>(
	"IssueFieldValue",
)({
	/**
	 * Unique identifier for the issue field.
	 */
	issue_field_id: S.Int,
	node_id: S.String,
	/**
	 * The data type of the issue field
	 */
	data_type: IssueFieldValueDataType,
	/**
	 * The value of the issue field
	 */
	value: S.NullOr(S.Union(S.String, S.Number, S.Int)),
	/**
	 * Details about the selected option (only present for single_select fields)
	 */
	single_select_option: S.optionalWith(
		S.Struct({
			/**
			 * Unique identifier for the option.
			 */
			id: S.Int,
			/**
			 * The name of the option
			 */
			name: S.String,
			/**
			 * The color of the option
			 */
			color: S.String,
		}),
		{ nullable: true },
	),
}) {}

/**
 * Issues are a great way to keep track of tasks, enhancements, and bugs for your projects.
 */
export class Issue extends S.Class<Issue>("Issue")({
	id: S.Int,
	node_id: S.String,
	/**
	 * URL for the issue
	 */
	url: S.String,
	repository_url: S.String,
	labels_url: S.String,
	comments_url: S.String,
	events_url: S.String,
	html_url: S.String,
	/**
	 * Number uniquely identifying the issue within its repository
	 */
	number: S.Int,
	/**
	 * State of the issue; either 'open' or 'closed'
	 */
	state: S.String,
	/**
	 * The reason for the current state
	 */
	state_reason: S.optionalWith(IssueStateReason, { nullable: true }),
	/**
	 * Title of the issue
	 */
	title: S.String,
	/**
	 * Contents of the issue
	 */
	body: S.optionalWith(S.String, { nullable: true }),
	user: S.NullOr(NullableSimpleUser),
	/**
	 * Labels to associate with this issue; pass one or more label names to replace the set of labels on this issue; send an empty array to clear all labels from the issue; note that the labels are silently dropped for users without push access to the repository
	 */
	labels: S.Array(
		S.Union(
			S.String,
			S.Struct({
				id: S.optionalWith(S.Int, { nullable: true }),
				node_id: S.optionalWith(S.String, { nullable: true }),
				url: S.optionalWith(S.String, { nullable: true }),
				name: S.optionalWith(S.String, { nullable: true }),
				description: S.optionalWith(S.String, { nullable: true }),
				color: S.optionalWith(S.String, { nullable: true }),
				default: S.optionalWith(S.Boolean, { nullable: true }),
			}),
		),
	),
	assignee: S.NullOr(NullableSimpleUser),
	assignees: S.optionalWith(S.Array(SimpleUser), { nullable: true }),
	milestone: S.NullOr(NullableMilestone),
	locked: S.Boolean,
	active_lock_reason: S.optionalWith(S.String, { nullable: true }),
	comments: S.Int,
	pull_request: S.optionalWith(
		S.Struct({
			merged_at: S.optionalWith(S.String, { nullable: true }),
			diff_url: S.NullOr(S.String),
			html_url: S.NullOr(S.String),
			patch_url: S.NullOr(S.String),
			url: S.NullOr(S.String),
		}),
		{ nullable: true },
	),
	closed_at: S.NullOr(S.String),
	created_at: S.String,
	updated_at: S.String,
	draft: S.optionalWith(S.Boolean, { nullable: true }),
	closed_by: S.optionalWith(NullableSimpleUser, { nullable: true }),
	body_html: S.optionalWith(S.String, { nullable: true }),
	body_text: S.optionalWith(S.String, { nullable: true }),
	timeline_url: S.optionalWith(S.String, { nullable: true }),
	type: S.optionalWith(IssueType, { nullable: true }),
	repository: S.optionalWith(Repository, { nullable: true }),
	performed_via_github_app: S.optionalWith(NullableIntegration, {
		nullable: true,
	}),
	author_association: S.optionalWith(AuthorAssociation, { nullable: true }),
	reactions: S.optionalWith(ReactionRollup, { nullable: true }),
	sub_issues_summary: S.optionalWith(SubIssuesSummary, { nullable: true }),
	/**
	 * URL to get the parent issue of this issue, if it is a sub-issue
	 */
	parent_issue_url: S.optionalWith(S.String, { nullable: true }),
	pinned_comment: S.optionalWith(NullableIssueComment, { nullable: true }),
	issue_dependencies_summary: S.optionalWith(IssueDependenciesSummary, {
		nullable: true,
	}),
	issue_field_values: S.optionalWith(S.Array(IssueFieldValue), {
		nullable: true,
	}),
}) {}

export class IssuesListForRepo200 extends S.Array(Issue) {}

export class IssuesCreateParams extends S.Struct({}) {}

export class IssuesCreateRequest extends S.Class<IssuesCreateRequest>(
	"IssuesCreateRequest",
)({
	/**
	 * The title of the issue.
	 */
	title: S.Union(S.String, S.Int),
	/**
	 * The contents of the issue.
	 */
	body: S.optionalWith(S.String, { nullable: true }),
	/**
	 * Login for the user that this issue should be assigned to. _NOTE: Only users with push access can set the assignee for new issues. The assignee is silently dropped otherwise. **This field is closing down.**_
	 */
	assignee: S.optionalWith(S.String, { nullable: true }),
	milestone: S.optionalWith(
		S.Union(
			S.String,
			/**
			 * The `number` of the milestone to associate this issue with. _NOTE: Only users with push access can set the milestone for new issues. The milestone is silently dropped otherwise._
			 */
			S.Int,
		),
		{ nullable: true },
	),
	/**
	 * Labels to associate with this issue. _NOTE: Only users with push access can set labels for new issues. Labels are silently dropped otherwise._
	 */
	labels: S.optionalWith(
		S.Array(
			S.Union(
				S.String,
				S.Struct({
					id: S.optionalWith(S.Int, { nullable: true }),
					name: S.optionalWith(S.String, { nullable: true }),
					description: S.optionalWith(S.String, { nullable: true }),
					color: S.optionalWith(S.String, { nullable: true }),
				}),
			),
		),
		{ nullable: true },
	),
	/**
	 * Logins for Users to assign to this issue. _NOTE: Only users with push access can set assignees for new issues. Assignees are silently dropped otherwise._
	 */
	assignees: S.optionalWith(S.Array(S.String), { nullable: true }),
	/**
	 * The name of the issue type to associate with this issue. _NOTE: Only users with push access can set the type for new issues. The type is silently dropped otherwise._
	 */
	type: S.optionalWith(S.String, { nullable: true }),
}) {}

export class IssuesCreate503 extends S.Struct({
	code: S.optionalWith(S.String, { nullable: true }),
	message: S.optionalWith(S.String, { nullable: true }),
	documentation_url: S.optionalWith(S.String, { nullable: true }),
}) {}

export class IssuesGetParams extends S.Struct({}) {}

export class IssuesUpdateParams extends S.Struct({}) {}

/**
 * The open or closed state of the issue.
 */
export class IssuesUpdateRequestState extends S.Literal("open", "closed") {}

/**
 * The reason for the state change. Ignored unless `state` is changed.
 */
export class IssuesUpdateRequestStateReason extends S.Literal(
	"completed",
	"not_planned",
	"duplicate",
	"reopened",
) {}

export class IssuesUpdateRequest extends S.Class<IssuesUpdateRequest>(
	"IssuesUpdateRequest",
)({
	/**
	 * The title of the issue.
	 */
	title: S.optionalWith(S.Union(S.String, S.Int), { nullable: true }),
	/**
	 * The contents of the issue.
	 */
	body: S.optionalWith(S.String, { nullable: true }),
	/**
	 * Username to assign to this issue. **This field is closing down.**
	 */
	assignee: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The open or closed state of the issue.
	 */
	state: S.optionalWith(IssuesUpdateRequestState, { nullable: true }),
	/**
	 * The reason for the state change. Ignored unless `state` is changed.
	 */
	state_reason: S.optionalWith(IssuesUpdateRequestStateReason, {
		nullable: true,
	}),
	milestone: S.optionalWith(
		S.Union(
			S.String,
			/**
			 * The `number` of the milestone to associate this issue with or use `null` to remove the current milestone. Only users with push access can set the milestone for issues. Without push access to the repository, milestone changes are silently dropped.
			 */
			S.Int,
		),
		{ nullable: true },
	),
	/**
	 * Labels to associate with this issue. Pass one or more labels to _replace_ the set of labels on this issue. Send an empty array (`[]`) to clear all labels from the issue. Only users with push access can set labels for issues. Without push access to the repository, label changes are silently dropped.
	 */
	labels: S.optionalWith(
		S.Array(
			S.Union(
				S.String,
				S.Struct({
					id: S.optionalWith(S.Int, { nullable: true }),
					name: S.optionalWith(S.String, { nullable: true }),
					description: S.optionalWith(S.String, { nullable: true }),
					color: S.optionalWith(S.String, { nullable: true }),
				}),
			),
		),
		{ nullable: true },
	),
	/**
	 * Usernames to assign to this issue. Pass one or more user logins to _replace_ the set of assignees on this issue. Send an empty array (`[]`) to clear all assignees from the issue. Only users with push access can set assignees for new issues. Without push access to the repository, assignee changes are silently dropped.
	 */
	assignees: S.optionalWith(S.Array(S.String), { nullable: true }),
	/**
	 * The name of the issue type to associate with this issue or use `null` to remove the current issue type. Only users with push access can set the type for issues. Without push access to the repository, type changes are silently dropped.
	 */
	type: S.optionalWith(S.String, { nullable: true }),
}) {}

export class IssuesUpdate503 extends S.Struct({
	code: S.optionalWith(S.String, { nullable: true }),
	message: S.optionalWith(S.String, { nullable: true }),
	documentation_url: S.optionalWith(S.String, { nullable: true }),
}) {}

export class IssuesListCommentsParams extends S.Struct({
	since: S.optionalWith(S.String, { nullable: true }),
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
}) {}

/**
 * Comments provide a way for people to collaborate on an issue.
 */
export class IssueComment extends S.Class<IssueComment>("IssueComment")({
	/**
	 * Unique identifier of the issue comment
	 */
	id: S.Int,
	node_id: S.String,
	/**
	 * URL for the issue comment
	 */
	url: S.String,
	/**
	 * Contents of the issue comment
	 */
	body: S.optionalWith(S.String, { nullable: true }),
	body_text: S.optionalWith(S.String, { nullable: true }),
	body_html: S.optionalWith(S.String, { nullable: true }),
	html_url: S.String,
	user: S.NullOr(NullableSimpleUser),
	created_at: S.String,
	updated_at: S.String,
	issue_url: S.String,
	author_association: S.optionalWith(AuthorAssociation, { nullable: true }),
	performed_via_github_app: S.optionalWith(NullableIntegration, {
		nullable: true,
	}),
	reactions: S.optionalWith(ReactionRollup, { nullable: true }),
	pin: S.optionalWith(NullablePinnedIssueComment, { nullable: true }),
}) {}

export class IssuesListComments200 extends S.Array(IssueComment) {}

export class IssuesCreateCommentParams extends S.Struct({}) {}

export class IssuesCreateCommentRequest extends S.Class<IssuesCreateCommentRequest>(
	"IssuesCreateCommentRequest",
)({
	/**
	 * The contents of the comment.
	 */
	body: S.String,
}) {}

export class IssuesListLabelsOnIssueParams extends S.Struct({
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
}) {}

/**
 * Color-coded labels help you categorize and filter your issues (just like labels in Gmail).
 */
export class Label extends S.Class<Label>("Label")({
	/**
	 * Unique identifier for the label.
	 */
	id: S.Int,
	node_id: S.String,
	/**
	 * URL for the label
	 */
	url: S.String,
	/**
	 * The name of the label.
	 */
	name: S.String,
	/**
	 * Optional description of the label, such as its purpose.
	 */
	description: S.NullOr(S.String),
	/**
	 * 6-character hex code, without the leading #, identifying the color
	 */
	color: S.String,
	/**
	 * Whether this label comes by default in a new repository.
	 */
	default: S.Boolean,
}) {}

export class IssuesListLabelsOnIssue200 extends S.Array(Label) {}

export class IssuesAddLabelsParams extends S.Struct({}) {}

export class IssuesAddLabelsRequest extends S.Union(
	S.Struct({
		/**
		 * The names of the labels to add to the issue's existing labels. You can also pass an `array` of labels directly, but GitHub recommends passing an object with the `labels` key. To replace all of the labels for an issue, use "[Set labels for an issue](https://docs.github.com/rest/issues/labels#set-labels-for-an-issue)."
		 */
		labels: S.optionalWith(S.NonEmptyArray(S.String).pipe(S.minItems(1)), {
			nullable: true,
		}),
	}),
	S.Array(S.String),
	S.Array(
		S.Struct({
			name: S.String,
		}),
	),
) {}

export class IssuesAddLabels200 extends S.Array(Label) {}

export class IssuesRemoveLabelParams extends S.Struct({}) {}

export class IssuesRemoveLabel200 extends S.Array(Label) {}

export class IssuesAddAssigneesParams extends S.Struct({}) {}

export class IssuesAddAssigneesRequest extends S.Class<IssuesAddAssigneesRequest>(
	"IssuesAddAssigneesRequest",
)({
	/**
	 * Usernames of people to assign this issue to. _NOTE: Only users with push access can add assignees to an issue. Assignees are silently ignored otherwise._
	 */
	assignees: S.optionalWith(S.Array(S.String), { nullable: true }),
}) {}

export class IssuesRemoveAssigneesParams extends S.Struct({}) {}

export class IssuesRemoveAssigneesRequest extends S.Class<IssuesRemoveAssigneesRequest>(
	"IssuesRemoveAssigneesRequest",
)({
	/**
	 * Usernames of assignees to remove from an issue. _NOTE: Only users with push access can remove assignees from an issue. Assignees are silently ignored otherwise._
	 */
	assignees: S.optionalWith(S.Array(S.String), { nullable: true }),
}) {}

export class ReposListCommitsParams extends S.Struct({
	sha: S.optionalWith(S.String, { nullable: true }),
	path: S.optionalWith(S.String, { nullable: true }),
	author: S.optionalWith(S.String, { nullable: true }),
	committer: S.optionalWith(S.String, { nullable: true }),
	since: S.optionalWith(S.String, { nullable: true }),
	until: S.optionalWith(S.String, { nullable: true }),
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
}) {}

/**
 * Metaproperties for Git author/committer information.
 */
export class NullableGitUser extends S.Class<NullableGitUser>(
	"NullableGitUser",
)({
	name: S.optionalWith(S.String, { nullable: true }),
	email: S.optionalWith(S.String, { nullable: true }),
	date: S.optionalWith(S.String, { nullable: true }),
}) {}

export class Verification extends S.Class<Verification>("Verification")({
	verified: S.Boolean,
	reason: S.String,
	payload: S.NullOr(S.String),
	signature: S.NullOr(S.String),
	verified_at: S.NullOr(S.String),
}) {}

/**
 * An object without any properties.
 */
export class EmptyObject extends S.Class<EmptyObject>("EmptyObject")({}) {}

/**
 * Commit
 */
export class Commit extends S.Class<Commit>("Commit")({
	url: S.String,
	sha: S.String,
	node_id: S.String,
	html_url: S.String,
	comments_url: S.String,
	commit: S.Struct({
		url: S.String,
		author: S.NullOr(NullableGitUser),
		committer: S.NullOr(NullableGitUser),
		message: S.String,
		comment_count: S.Int,
		tree: S.Struct({
			sha: S.String,
			url: S.String,
		}),
		verification: S.optionalWith(Verification, { nullable: true }),
	}),
	author: S.NullOr(S.Union(SimpleUser, EmptyObject)),
	committer: S.NullOr(S.Union(SimpleUser, EmptyObject)),
	parents: S.Array(
		S.Struct({
			sha: S.String,
			url: S.String,
			html_url: S.optionalWith(S.String, { nullable: true }),
		}),
	),
	stats: S.optionalWith(
		S.Struct({
			additions: S.optionalWith(S.Int, { nullable: true }),
			deletions: S.optionalWith(S.Int, { nullable: true }),
			total: S.optionalWith(S.Int, { nullable: true }),
		}),
		{ nullable: true },
	),
	files: S.optionalWith(S.Array(DiffEntry), { nullable: true }),
}) {}

export class ReposListCommits200 extends S.Array(Commit) {}

export class ChecksListForRefParamsStatus extends S.Literal(
	"queued",
	"in_progress",
	"completed",
) {}

export class ChecksListForRefParamsFilter extends S.Literal("latest", "all") {}

export class ChecksListForRefParams extends S.Struct({
	check_name: S.optionalWith(S.String, { nullable: true }),
	status: S.optionalWith(ChecksListForRefParamsStatus, { nullable: true }),
	filter: S.optionalWith(ChecksListForRefParamsFilter, {
		nullable: true,
		default: () => "latest" as const,
	}),
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
	app_id: S.optionalWith(S.Int, { nullable: true }),
}) {}

/**
 * The phase of the lifecycle that the check is currently in. Statuses of waiting, requested, and pending are reserved for GitHub Actions check runs.
 */
export class CheckRunStatus extends S.Literal(
	"queued",
	"in_progress",
	"completed",
	"waiting",
	"requested",
	"pending",
) {}

export class CheckRunConclusion extends S.Literal(
	"success",
	"failure",
	"neutral",
	"cancelled",
	"skipped",
	"timed_out",
	"action_required",
) {}

export class PullRequestMinimal extends S.Class<PullRequestMinimal>(
	"PullRequestMinimal",
)({
	id: S.Int,
	number: S.Int,
	url: S.String,
	head: S.Struct({
		ref: S.String,
		sha: S.String,
		repo: S.Struct({
			id: S.Int,
			url: S.String,
			name: S.String,
		}),
	}),
	base: S.Struct({
		ref: S.String,
		sha: S.String,
		repo: S.Struct({
			id: S.Int,
			url: S.String,
			name: S.String,
		}),
	}),
}) {}

/**
 * A deployment created as the result of an Actions check run from a workflow that references an environment
 */
export class DeploymentSimple extends S.Class<DeploymentSimple>(
	"DeploymentSimple",
)({
	url: S.String,
	/**
	 * Unique identifier of the deployment
	 */
	id: S.Int,
	node_id: S.String,
	/**
	 * Parameter to specify a task to execute
	 */
	task: S.String,
	original_environment: S.optionalWith(S.String, { nullable: true }),
	/**
	 * Name for the target deployment environment.
	 */
	environment: S.String,
	description: S.NullOr(S.String),
	created_at: S.String,
	updated_at: S.String,
	statuses_url: S.String,
	repository_url: S.String,
	/**
	 * Specifies if the given environment is will no longer exist at some point in the future. Default: false.
	 */
	transient_environment: S.optionalWith(S.Boolean, { nullable: true }),
	/**
	 * Specifies if the given environment is one that end-users directly interact with. Default: false.
	 */
	production_environment: S.optionalWith(S.Boolean, { nullable: true }),
	performed_via_github_app: S.optionalWith(NullableIntegration, {
		nullable: true,
	}),
}) {}

/**
 * A check performed on the code of a given code change
 */
export class CheckRun extends S.Class<CheckRun>("CheckRun")({
	/**
	 * The id of the check.
	 */
	id: S.Int,
	/**
	 * The SHA of the commit that is being checked.
	 */
	head_sha: S.String,
	node_id: S.String,
	external_id: S.NullOr(S.String),
	url: S.String,
	html_url: S.NullOr(S.String),
	details_url: S.NullOr(S.String),
	/**
	 * The phase of the lifecycle that the check is currently in. Statuses of waiting, requested, and pending are reserved for GitHub Actions check runs.
	 */
	status: CheckRunStatus,
	conclusion: S.NullOr(CheckRunConclusion),
	started_at: S.NullOr(S.String),
	completed_at: S.NullOr(S.String),
	output: S.Struct({
		title: S.NullOr(S.String),
		summary: S.NullOr(S.String),
		text: S.NullOr(S.String),
		annotations_count: S.Int,
		annotations_url: S.String,
	}),
	/**
	 * The name of the check.
	 */
	name: S.String,
	check_suite: S.NullOr(
		S.Struct({
			id: S.Int,
		}),
	),
	app: S.NullOr(NullableIntegration),
	/**
	 * Pull requests that are open with a `head_sha` or `head_branch` that matches the check. The returned pull requests do not necessarily indicate pull requests that triggered the check.
	 */
	pull_requests: S.Array(PullRequestMinimal),
	deployment: S.optionalWith(DeploymentSimple, { nullable: true }),
}) {}

export class ChecksListForRef200 extends S.Struct({
	total_count: S.Int,
	check_runs: S.Array(CheckRun),
}) {}

export class ActionsListWorkflowRunsForRepoParamsStatus extends S.Literal(
	"completed",
	"action_required",
	"cancelled",
	"failure",
	"neutral",
	"skipped",
	"stale",
	"success",
	"timed_out",
	"in_progress",
	"queued",
	"requested",
	"waiting",
	"pending",
) {}

export class ActionsListWorkflowRunsForRepoParams extends S.Struct({
	actor: S.optionalWith(S.String, { nullable: true }),
	branch: S.optionalWith(S.String, { nullable: true }),
	event: S.optionalWith(S.String, { nullable: true }),
	status: S.optionalWith(ActionsListWorkflowRunsForRepoParamsStatus, {
		nullable: true,
	}),
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
	created: S.optionalWith(S.String, { nullable: true }),
	exclude_pull_requests: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => false as const,
	}),
	check_suite_id: S.optionalWith(S.Int, { nullable: true }),
	head_sha: S.optionalWith(S.String, { nullable: true }),
}) {}

/**
 * A workflow referenced/reused by the initial caller workflow
 */
export class ReferencedWorkflow extends S.Class<ReferencedWorkflow>(
	"ReferencedWorkflow",
)({
	path: S.String,
	sha: S.String,
	ref: S.optionalWith(S.String, { nullable: true }),
}) {}

/**
 * A commit.
 */
export class NullableSimpleCommit extends S.Class<NullableSimpleCommit>(
	"NullableSimpleCommit",
)({
	/**
	 * SHA for the commit
	 */
	id: S.String,
	/**
	 * SHA for the commit's tree
	 */
	tree_id: S.String,
	/**
	 * Message describing the purpose of the commit
	 */
	message: S.String,
	/**
	 * Timestamp of the commit
	 */
	timestamp: S.String,
	/**
	 * Information about the Git author
	 */
	author: S.NullOr(
		S.Struct({
			/**
			 * Name of the commit's author
			 */
			name: S.String,
			/**
			 * Git email address of the commit's author
			 */
			email: S.String,
		}),
	),
	/**
	 * Information about the Git committer
	 */
	committer: S.NullOr(
		S.Struct({
			/**
			 * Name of the commit's committer
			 */
			name: S.String,
			/**
			 * Git email address of the commit's committer
			 */
			email: S.String,
		}),
	),
}) {}

/**
 * The policy controlling who can create pull requests: all or collaborators_only.
 */
export class MinimalRepositoryPullRequestCreationPolicy extends S.Literal(
	"all",
	"collaborators_only",
) {}

/**
 * Code Of Conduct
 */
export class CodeOfConduct extends S.Class<CodeOfConduct>("CodeOfConduct")({
	key: S.String,
	name: S.String,
	url: S.String,
	body: S.optionalWith(S.String, { nullable: true }),
	html_url: S.NullOr(S.String),
}) {}

/**
 * Minimal Repository
 */
export class MinimalRepository extends S.Class<MinimalRepository>(
	"MinimalRepository",
)({
	id: S.Int,
	node_id: S.String,
	name: S.String,
	full_name: S.String,
	owner: SimpleUser,
	private: S.Boolean,
	html_url: S.String,
	description: S.NullOr(S.String),
	fork: S.Boolean,
	url: S.String,
	archive_url: S.String,
	assignees_url: S.String,
	blobs_url: S.String,
	branches_url: S.String,
	collaborators_url: S.String,
	comments_url: S.String,
	commits_url: S.String,
	compare_url: S.String,
	contents_url: S.String,
	contributors_url: S.String,
	deployments_url: S.String,
	downloads_url: S.String,
	events_url: S.String,
	forks_url: S.String,
	git_commits_url: S.String,
	git_refs_url: S.String,
	git_tags_url: S.String,
	git_url: S.optionalWith(S.String, { nullable: true }),
	issue_comment_url: S.String,
	issue_events_url: S.String,
	issues_url: S.String,
	keys_url: S.String,
	labels_url: S.String,
	languages_url: S.String,
	merges_url: S.String,
	milestones_url: S.String,
	notifications_url: S.String,
	pulls_url: S.String,
	releases_url: S.String,
	ssh_url: S.optionalWith(S.String, { nullable: true }),
	stargazers_url: S.String,
	statuses_url: S.String,
	subscribers_url: S.String,
	subscription_url: S.String,
	tags_url: S.String,
	teams_url: S.String,
	trees_url: S.String,
	clone_url: S.optionalWith(S.String, { nullable: true }),
	mirror_url: S.optionalWith(S.String, { nullable: true }),
	hooks_url: S.String,
	svn_url: S.optionalWith(S.String, { nullable: true }),
	homepage: S.optionalWith(S.String, { nullable: true }),
	language: S.optionalWith(S.String, { nullable: true }),
	forks_count: S.optionalWith(S.Int, { nullable: true }),
	stargazers_count: S.optionalWith(S.Int, { nullable: true }),
	watchers_count: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * The size of the repository, in kilobytes. Size is calculated hourly. When a repository is initially created, the size is 0.
	 */
	size: S.optionalWith(S.Int, { nullable: true }),
	default_branch: S.optionalWith(S.String, { nullable: true }),
	open_issues_count: S.optionalWith(S.Int, { nullable: true }),
	is_template: S.optionalWith(S.Boolean, { nullable: true }),
	topics: S.optionalWith(S.Array(S.String), { nullable: true }),
	has_issues: S.optionalWith(S.Boolean, { nullable: true }),
	has_projects: S.optionalWith(S.Boolean, { nullable: true }),
	has_wiki: S.optionalWith(S.Boolean, { nullable: true }),
	has_pages: S.optionalWith(S.Boolean, { nullable: true }),
	has_downloads: S.optionalWith(S.Boolean, { nullable: true }),
	has_discussions: S.optionalWith(S.Boolean, { nullable: true }),
	has_pull_requests: S.optionalWith(S.Boolean, { nullable: true }),
	/**
	 * The policy controlling who can create pull requests: all or collaborators_only.
	 */
	pull_request_creation_policy: S.optionalWith(
		MinimalRepositoryPullRequestCreationPolicy,
		{ nullable: true },
	),
	archived: S.optionalWith(S.Boolean, { nullable: true }),
	disabled: S.optionalWith(S.Boolean, { nullable: true }),
	visibility: S.optionalWith(S.String, { nullable: true }),
	pushed_at: S.optionalWith(S.String, { nullable: true }),
	created_at: S.optionalWith(S.String, { nullable: true }),
	updated_at: S.optionalWith(S.String, { nullable: true }),
	permissions: S.optionalWith(
		S.Struct({
			admin: S.optionalWith(S.Boolean, { nullable: true }),
			maintain: S.optionalWith(S.Boolean, { nullable: true }),
			push: S.optionalWith(S.Boolean, { nullable: true }),
			triage: S.optionalWith(S.Boolean, { nullable: true }),
			pull: S.optionalWith(S.Boolean, { nullable: true }),
		}),
		{ nullable: true },
	),
	role_name: S.optionalWith(S.String, { nullable: true }),
	temp_clone_token: S.optionalWith(S.String, { nullable: true }),
	delete_branch_on_merge: S.optionalWith(S.Boolean, { nullable: true }),
	subscribers_count: S.optionalWith(S.Int, { nullable: true }),
	network_count: S.optionalWith(S.Int, { nullable: true }),
	code_of_conduct: S.optionalWith(CodeOfConduct, { nullable: true }),
	license: S.optionalWith(
		S.Struct({
			key: S.optionalWith(S.String, { nullable: true }),
			name: S.optionalWith(S.String, { nullable: true }),
			spdx_id: S.optionalWith(S.String, { nullable: true }),
			url: S.optionalWith(S.String, { nullable: true }),
			node_id: S.optionalWith(S.String, { nullable: true }),
		}),
		{ nullable: true },
	),
	forks: S.optionalWith(S.Int, { nullable: true }),
	open_issues: S.optionalWith(S.Int, { nullable: true }),
	watchers: S.optionalWith(S.Int, { nullable: true }),
	allow_forking: S.optionalWith(S.Boolean, { nullable: true }),
	web_commit_signoff_required: S.optionalWith(S.Boolean, { nullable: true }),
	security_and_analysis: S.optionalWith(SecurityAndAnalysis, {
		nullable: true,
	}),
	/**
	 * The custom properties that were defined for the repository. The keys are the custom property names, and the values are the corresponding custom property values.
	 */
	custom_properties: S.optionalWith(
		S.Record({ key: S.String, value: S.Unknown }),
		{ nullable: true },
	),
}) {}

/**
 * An invocation of a workflow
 */
export class WorkflowRun extends S.Class<WorkflowRun>("WorkflowRun")({
	/**
	 * The ID of the workflow run.
	 */
	id: S.Int,
	/**
	 * The name of the workflow run.
	 */
	name: S.optionalWith(S.String, { nullable: true }),
	node_id: S.String,
	/**
	 * The ID of the associated check suite.
	 */
	check_suite_id: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * The node ID of the associated check suite.
	 */
	check_suite_node_id: S.optionalWith(S.String, { nullable: true }),
	head_branch: S.NullOr(S.String),
	/**
	 * The SHA of the head commit that points to the version of the workflow being run.
	 */
	head_sha: S.String,
	/**
	 * The full path of the workflow
	 */
	path: S.String,
	/**
	 * The auto incrementing run number for the workflow run.
	 */
	run_number: S.Int,
	/**
	 * Attempt number of the run, 1 for first attempt and higher if the workflow was re-run.
	 */
	run_attempt: S.optionalWith(S.Int, { nullable: true }),
	referenced_workflows: S.optionalWith(S.Array(ReferencedWorkflow), {
		nullable: true,
	}),
	event: S.String,
	status: S.NullOr(S.String),
	conclusion: S.NullOr(S.String),
	/**
	 * The ID of the parent workflow.
	 */
	workflow_id: S.Int,
	/**
	 * The URL to the workflow run.
	 */
	url: S.String,
	html_url: S.String,
	/**
	 * Pull requests that are open with a `head_sha` or `head_branch` that matches the workflow run. The returned pull requests do not necessarily indicate pull requests that triggered the run.
	 */
	pull_requests: S.NullOr(S.Array(PullRequestMinimal)),
	created_at: S.String,
	updated_at: S.String,
	actor: S.optionalWith(SimpleUser, { nullable: true }),
	triggering_actor: S.optionalWith(SimpleUser, { nullable: true }),
	/**
	 * The start time of the latest run. Resets on re-run.
	 */
	run_started_at: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The URL to the jobs for the workflow run.
	 */
	jobs_url: S.String,
	/**
	 * The URL to download the logs for the workflow run.
	 */
	logs_url: S.String,
	/**
	 * The URL to the associated check suite.
	 */
	check_suite_url: S.String,
	/**
	 * The URL to the artifacts for the workflow run.
	 */
	artifacts_url: S.String,
	/**
	 * The URL to cancel the workflow run.
	 */
	cancel_url: S.String,
	/**
	 * The URL to rerun the workflow run.
	 */
	rerun_url: S.String,
	/**
	 * The URL to the previous attempted run of this workflow, if one exists.
	 */
	previous_attempt_url: S.optionalWith(S.String, { nullable: true }),
	/**
	 * The URL to the workflow.
	 */
	workflow_url: S.String,
	head_commit: S.NullOr(NullableSimpleCommit),
	repository: MinimalRepository,
	head_repository: MinimalRepository,
	head_repository_id: S.optionalWith(S.Int, { nullable: true }),
	/**
	 * The event-specific title associated with the run or the run-name if set, or the value of `run-name` if it is set in the workflow.
	 */
	display_title: S.String,
}) {}

export class ActionsListWorkflowRunsForRepo200 extends S.Struct({
	total_count: S.Int,
	workflow_runs: S.Array(WorkflowRun),
}) {}

export class ActionsListJobsForWorkflowRunParamsFilter extends S.Literal(
	"latest",
	"all",
) {}

export class ActionsListJobsForWorkflowRunParams extends S.Struct({
	filter: S.optionalWith(ActionsListJobsForWorkflowRunParamsFilter, {
		nullable: true,
		default: () => "latest" as const,
	}),
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
}) {}

/**
 * The phase of the lifecycle that the job is currently in.
 */
export class JobStatus extends S.Literal(
	"queued",
	"in_progress",
	"completed",
	"waiting",
	"requested",
	"pending",
) {}

/**
 * The outcome of the job.
 */
export class JobConclusion extends S.Literal(
	"success",
	"failure",
	"neutral",
	"cancelled",
	"skipped",
	"timed_out",
	"action_required",
) {}

/**
 * Information of a job execution in a workflow run
 */
export class Job extends S.Class<Job>("Job")({
	/**
	 * The id of the job.
	 */
	id: S.Int,
	/**
	 * The id of the associated workflow run.
	 */
	run_id: S.Int,
	run_url: S.String,
	/**
	 * Attempt number of the associated workflow run, 1 for first attempt and higher if the workflow was re-run.
	 */
	run_attempt: S.optionalWith(S.Int, { nullable: true }),
	node_id: S.String,
	/**
	 * The SHA of the commit that is being run.
	 */
	head_sha: S.String,
	url: S.String,
	html_url: S.NullOr(S.String),
	/**
	 * The phase of the lifecycle that the job is currently in.
	 */
	status: JobStatus,
	/**
	 * The outcome of the job.
	 */
	conclusion: S.NullOr(JobConclusion),
	/**
	 * The time that the job created, in ISO 8601 format.
	 */
	created_at: S.String,
	/**
	 * The time that the job started, in ISO 8601 format.
	 */
	started_at: S.String,
	/**
	 * The time that the job finished, in ISO 8601 format.
	 */
	completed_at: S.NullOr(S.String),
	/**
	 * The name of the job.
	 */
	name: S.String,
	/**
	 * Steps in this job.
	 */
	steps: S.optionalWith(
		S.Array(
			S.Struct({
				/**
				 * The phase of the lifecycle that the job is currently in.
				 */
				status: S.Literal("queued", "in_progress", "completed"),
				/**
				 * The outcome of the job.
				 */
				conclusion: S.NullOr(S.String),
				/**
				 * The name of the job.
				 */
				name: S.String,
				number: S.Int,
				/**
				 * The time that the step started, in ISO 8601 format.
				 */
				started_at: S.optionalWith(S.String, { nullable: true }),
				/**
				 * The time that the job finished, in ISO 8601 format.
				 */
				completed_at: S.optionalWith(S.String, { nullable: true }),
			}),
		),
		{ nullable: true },
	),
	check_run_url: S.String,
	/**
	 * Labels for the workflow job. Specified by the "runs_on" attribute in the action's workflow file.
	 */
	labels: S.Array(S.String),
	/**
	 * The ID of the runner to which this job has been assigned. (If a runner hasn't yet been assigned, this will be null.)
	 */
	runner_id: S.NullOr(S.Int),
	/**
	 * The name of the runner to which this job has been assigned. (If a runner hasn't yet been assigned, this will be null.)
	 */
	runner_name: S.NullOr(S.String),
	/**
	 * The ID of the runner group to which this job has been assigned. (If a runner hasn't yet been assigned, this will be null.)
	 */
	runner_group_id: S.NullOr(S.Int),
	/**
	 * The name of the runner group to which this job has been assigned. (If a runner hasn't yet been assigned, this will be null.)
	 */
	runner_group_name: S.NullOr(S.String),
	/**
	 * The name of the workflow.
	 */
	workflow_name: S.NullOr(S.String),
	/**
	 * The name of the current branch.
	 */
	head_branch: S.NullOr(S.String),
}) {}

export class ActionsListJobsForWorkflowRun200 extends S.Struct({
	total_count: S.Int,
	jobs: S.Array(Job),
}) {}

export class GitGetTreeParams extends S.Struct({
	recursive: S.optionalWith(S.String, { nullable: true }),
}) {}

/**
 * The hierarchy between files in a Git repository.
 */
export class GitTree extends S.Class<GitTree>("GitTree")({
	sha: S.String,
	url: S.optionalWith(S.String, { nullable: true }),
	truncated: S.Boolean,
	/**
	 * Objects specifying a tree structure
	 */
	tree: S.Array(
		S.Struct({
			path: S.String,
			mode: S.String,
			type: S.String,
			sha: S.String,
			size: S.optionalWith(S.Int, { nullable: true }),
			url: S.optionalWith(S.String, { nullable: true }),
		}),
	),
}) {}

export class ReposGetContentParams extends S.Struct({
	ref: S.optionalWith(S.String, { nullable: true }),
}) {}

/**
 * A list of directory items
 */
export class ContentDirectory extends S.Array(
	S.Struct({
		type: S.Literal("dir", "file", "submodule", "symlink"),
		size: S.Int,
		name: S.String,
		path: S.String,
		content: S.optionalWith(S.String, { nullable: true }),
		sha: S.String,
		url: S.String,
		git_url: S.NullOr(S.String),
		html_url: S.NullOr(S.String),
		download_url: S.NullOr(S.String),
		_links: S.Struct({
			git: S.NullOr(S.String),
			html: S.NullOr(S.String),
			self: S.String,
		}),
	}),
) {}

export class ContentFileType extends S.Literal("file") {}

/**
 * Content File
 */
export class ContentFile extends S.Class<ContentFile>("ContentFile")({
	type: ContentFileType,
	encoding: S.String,
	size: S.Int,
	name: S.String,
	path: S.String,
	content: S.String,
	sha: S.String,
	url: S.String,
	git_url: S.NullOr(S.String),
	html_url: S.NullOr(S.String),
	download_url: S.NullOr(S.String),
	_links: S.Struct({
		git: S.NullOr(S.String),
		html: S.NullOr(S.String),
		self: S.String,
	}),
	target: S.optionalWith(S.String, { nullable: true }),
	submodule_git_url: S.optionalWith(S.String, { nullable: true }),
}) {}

export class ContentSymlinkType extends S.Literal("symlink") {}

/**
 * An object describing a symlink
 */
export class ContentSymlink extends S.Class<ContentSymlink>("ContentSymlink")({
	type: ContentSymlinkType,
	target: S.String,
	size: S.Int,
	name: S.String,
	path: S.String,
	sha: S.String,
	url: S.String,
	git_url: S.NullOr(S.String),
	html_url: S.NullOr(S.String),
	download_url: S.NullOr(S.String),
	_links: S.Struct({
		git: S.NullOr(S.String),
		html: S.NullOr(S.String),
		self: S.String,
	}),
}) {}

export class ContentSubmoduleType extends S.Literal("submodule") {}

/**
 * An object describing a submodule
 */
export class ContentSubmodule extends S.Class<ContentSubmodule>(
	"ContentSubmodule",
)({
	type: ContentSubmoduleType,
	submodule_git_url: S.String,
	size: S.Int,
	name: S.String,
	path: S.String,
	sha: S.String,
	url: S.String,
	git_url: S.NullOr(S.String),
	html_url: S.NullOr(S.String),
	download_url: S.NullOr(S.String),
	_links: S.Struct({
		git: S.NullOr(S.String),
		html: S.NullOr(S.String),
		self: S.String,
	}),
}) {}

export class ReposGetContent200 extends S.Union(
	ContentDirectory,
	ContentFile,
	ContentSymlink,
	ContentSubmodule,
) {}

export class ReposCreateWebhookParams extends S.Struct({}) {}

/**
 * The URL to which the payloads will be delivered.
 */
export class WebhookConfigUrl extends S.String {}

/**
 * The media type used to serialize the payloads. Supported values include `json` and `form`. The default is `form`.
 */
export class WebhookConfigContentType extends S.String {}

/**
 * If provided, the `secret` will be used as the `key` to generate the HMAC hex digest value for [delivery signature headers](https://docs.github.com/webhooks/event-payloads/#delivery-headers).
 */
export class WebhookConfigSecret extends S.String {}

export class WebhookConfigInsecureSsl extends S.Union(
	/**
	 * Determines whether the SSL certificate of the host for `url` will be verified when delivering payloads. Supported values include `0` (verification is performed) and `1` (verification is not performed). The default is `0`. **We strongly recommend not setting this to `1` as you are subject to man-in-the-middle and other attacks.**
	 */
	S.String,
	S.Number,
) {}

export class ReposCreateWebhookRequest extends S.Class<ReposCreateWebhookRequest>(
	"ReposCreateWebhookRequest",
)({
	/**
	 * Use `web` to create a webhook. Default: `web`. This parameter only accepts the value `web`.
	 */
	name: S.optionalWith(S.String, { nullable: true }),
	/**
	 * Key/value pairs to provide settings for this webhook.
	 */
	config: S.optionalWith(
		S.Struct({
			url: S.optionalWith(WebhookConfigUrl, { nullable: true }),
			content_type: S.optionalWith(WebhookConfigContentType, {
				nullable: true,
			}),
			secret: S.optionalWith(WebhookConfigSecret, { nullable: true }),
			insecure_ssl: S.optionalWith(WebhookConfigInsecureSsl, {
				nullable: true,
			}),
		}),
		{ nullable: true },
	),
	/**
	 * Determines what [events](https://docs.github.com/webhooks/event-payloads) the hook is triggered for.
	 */
	events: S.optionalWith(S.Array(S.String), {
		nullable: true,
		default: () => ["push"] as const,
	}),
	/**
	 * Determines if notifications are sent when the webhook is triggered. Set to `true` to send notifications.
	 */
	active: S.optionalWith(S.Boolean, {
		nullable: true,
		default: () => true as const,
	}),
}) {}

/**
 * Configuration object of the webhook
 */
export class WebhookConfig extends S.Class<WebhookConfig>("WebhookConfig")({
	url: S.optionalWith(WebhookConfigUrl, { nullable: true }),
	content_type: S.optionalWith(WebhookConfigContentType, { nullable: true }),
	secret: S.optionalWith(WebhookConfigSecret, { nullable: true }),
	insecure_ssl: S.optionalWith(WebhookConfigInsecureSsl, { nullable: true }),
}) {}

export class HookResponse extends S.Class<HookResponse>("HookResponse")({
	code: S.NullOr(S.Int),
	status: S.NullOr(S.String),
	message: S.NullOr(S.String),
}) {}

/**
 * Webhooks for repositories.
 */
export class Hook extends S.Class<Hook>("Hook")({
	type: S.String,
	/**
	 * Unique identifier of the webhook.
	 */
	id: S.Int,
	/**
	 * The name of a valid service, use 'web' for a webhook.
	 */
	name: S.String,
	/**
	 * Determines whether the hook is actually triggered on pushes.
	 */
	active: S.Boolean,
	/**
	 * Determines what events the hook is triggered for. Default: ['push'].
	 */
	events: S.Array(S.String),
	config: WebhookConfig,
	updated_at: S.String,
	created_at: S.String,
	url: S.String,
	test_url: S.String,
	ping_url: S.String,
	deliveries_url: S.optionalWith(S.String, { nullable: true }),
	last_response: HookResponse,
}) {}

export class ActivityListNotificationsForAuthenticatedUserParams extends S.Struct(
	{
		all: S.optionalWith(S.Boolean, {
			nullable: true,
			default: () => false as const,
		}),
		participating: S.optionalWith(S.Boolean, {
			nullable: true,
			default: () => false as const,
		}),
		since: S.optionalWith(S.String, { nullable: true }),
		before: S.optionalWith(S.String, { nullable: true }),
		page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
		per_page: S.optionalWith(S.Int, {
			nullable: true,
			default: () => 50 as const,
		}),
	},
) {}

/**
 * Thread
 */
export class Thread extends S.Class<Thread>("Thread")({
	id: S.String,
	repository: MinimalRepository,
	subject: S.Struct({
		title: S.String,
		url: S.String,
		latest_comment_url: S.String,
		type: S.String,
	}),
	reason: S.String,
	unread: S.Boolean,
	updated_at: S.String,
	last_read_at: S.NullOr(S.String),
	url: S.String,
	subscription_url: S.String,
}) {}

export class ActivityListNotificationsForAuthenticatedUser200 extends S.Array(
	Thread,
) {}

export class ActivityMarkThreadAsReadParams extends S.Struct({}) {}

export class ReposListForAuthenticatedUserParamsVisibility extends S.Literal(
	"all",
	"public",
	"private",
) {}

export class ReposListForAuthenticatedUserParamsType extends S.Literal(
	"all",
	"owner",
	"public",
	"private",
	"member",
) {}

export class ReposListForAuthenticatedUserParamsSort extends S.Literal(
	"created",
	"updated",
	"pushed",
	"full_name",
) {}

export class ReposListForAuthenticatedUserParamsDirection extends S.Literal(
	"asc",
	"desc",
) {}

export class ReposListForAuthenticatedUserParams extends S.Struct({
	visibility: S.optionalWith(ReposListForAuthenticatedUserParamsVisibility, {
		nullable: true,
		default: () => "all" as const,
	}),
	affiliation: S.optionalWith(S.String, {
		nullable: true,
		default: () => "owner,collaborator,organization_member" as const,
	}),
	type: S.optionalWith(ReposListForAuthenticatedUserParamsType, {
		nullable: true,
		default: () => "all" as const,
	}),
	sort: S.optionalWith(ReposListForAuthenticatedUserParamsSort, {
		nullable: true,
		default: () => "full_name" as const,
	}),
	direction: S.optionalWith(ReposListForAuthenticatedUserParamsDirection, {
		nullable: true,
	}),
	per_page: S.optionalWith(S.Int, {
		nullable: true,
		default: () => 30 as const,
	}),
	page: S.optionalWith(S.Int, { nullable: true, default: () => 1 as const }),
	since: S.optionalWith(S.String, { nullable: true }),
	before: S.optionalWith(S.String, { nullable: true }),
}) {}

export class ReposListForAuthenticatedUser200 extends S.Array(Repository) {}

export const make = (
	httpClient: HttpClient.HttpClient,
	options: {
		readonly transformClient?:
			| ((
					client: HttpClient.HttpClient,
			  ) => Effect.Effect<HttpClient.HttpClient>)
			| undefined;
	} = {},
): GitHubClient => {
	const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
		Effect.flatMap(
			Effect.orElseSucceed(response.json, () => "Unexpected status code"),
			(description) =>
				Effect.fail(
					new HttpClientError.ResponseError({
						request: response.request,
						response,
						reason: "StatusCode",
						description:
							typeof description === "string"
								? description
								: JSON.stringify(description),
					}),
				),
		);
	const withResponse: <A, E>(
		f: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E>,
	) => (
		request: HttpClientRequest.HttpClientRequest,
	) => Effect.Effect<any, any> = options.transformClient
		? (f) => (request) =>
				Effect.flatMap(
					Effect.flatMap(options.transformClient!(httpClient), (client) =>
						client.execute(request),
					),
					f,
				)
		: (f) => (request) => Effect.flatMap(httpClient.execute(request), f);
	const decodeSuccess =
		<A, I, R>(schema: S.Schema<A, I, R>) =>
		(response: HttpClientResponse.HttpClientResponse) =>
			HttpClientResponse.schemaBodyJson(schema)(response);
	const decodeError =
		<const Tag extends string, A, I, R>(tag: Tag, schema: S.Schema<A, I, R>) =>
		(response: HttpClientResponse.HttpClientResponse) =>
			Effect.flatMap(
				HttpClientResponse.schemaBodyJson(schema)(response),
				(cause) => Effect.fail(GitHubClientError(tag, cause, response)),
			);
	return {
		httpClient,
		appsCreateInstallationAccessToken: (installationId, options) =>
			HttpClientRequest.post(
				`/app/installations/${installationId}/access_tokens`,
			).pipe(
				HttpClientRequest.bodyUnsafeJson(options.payload),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(InstallationToken),
						"401": decodeError("BasicError", BasicError),
						"403": decodeError("BasicError", BasicError),
						"404": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationError", ValidationError),
						orElse: unexpectedStatus,
					}),
				),
			),
		reposGet: (owner, repo, options) =>
			HttpClientRequest.get(`/repos/${owner}/${repo}`).pipe(
				withResponse(
					HttpClientResponse.matchStatus({
						"200": decodeSuccess(FullRepository),
						"301": decodeSuccess(BasicError),
						"403": decodeError("BasicError", BasicError),
						"404": decodeError("BasicError", BasicError),
						orElse: unexpectedStatus,
					}),
				),
			),
		reposListBranches: (owner, repo, options) =>
			HttpClientRequest.get(`/repos/${owner}/${repo}/branches`).pipe(
				HttpClientRequest.setUrlParams({
					protected: options?.["protected"] as any,
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(ReposListBranches200),
						"404": decodeError("BasicError", BasicError),
						orElse: unexpectedStatus,
					}),
				),
			),
		pullsList: (owner, repo, options) =>
			HttpClientRequest.get(`/repos/${owner}/${repo}/pulls`).pipe(
				HttpClientRequest.setUrlParams({
					state: options?.["state"] as any,
					head: options?.["head"] as any,
					base: options?.["base"] as any,
					sort: options?.["sort"] as any,
					direction: options?.["direction"] as any,
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(PullsList200),
						"422": decodeError("ValidationError", ValidationError),
						"304": () => Effect.void,
						orElse: unexpectedStatus,
					}),
				),
			),
		pullsGet: (owner, repo, pullNumber, options) =>
			HttpClientRequest.get(`/repos/${owner}/${repo}/pulls/${pullNumber}`).pipe(
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(PullRequest),
						"404": decodeError("BasicError", BasicError),
						"406": decodeError("BasicError", BasicError),
						"500": decodeError("BasicError", BasicError),
						"503": decodeError("PullsGet503", PullsGet503),
						"304": () => Effect.void,
						orElse: unexpectedStatus,
					}),
				),
			),
		pullsMerge: (owner, repo, pullNumber, options) =>
			HttpClientRequest.put(
				`/repos/${owner}/${repo}/pulls/${pullNumber}/merge`,
			).pipe(
				HttpClientRequest.bodyUnsafeJson(options.payload),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(PullRequestMergeResult),
						"403": decodeError("BasicError", BasicError),
						"404": decodeError("BasicError", BasicError),
						"405": decodeError("PullsMerge405", PullsMerge405),
						"409": decodeError("PullsMerge409", PullsMerge409),
						"422": decodeError("ValidationError", ValidationError),
						orElse: unexpectedStatus,
					}),
				),
			),
		pullsListReviews: (owner, repo, pullNumber, options) =>
			HttpClientRequest.get(
				`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
			).pipe(
				HttpClientRequest.setUrlParams({
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(PullsListReviews200),
						orElse: unexpectedStatus,
					}),
				),
			),
		pullsCreateReview: (owner, repo, pullNumber, options) =>
			HttpClientRequest.post(
				`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
			).pipe(
				HttpClientRequest.bodyUnsafeJson(options.payload),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(PullRequestReview),
						"403": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationErrorSimple", ValidationErrorSimple),
						orElse: unexpectedStatus,
					}),
				),
			),
		pullsListReviewComments: (owner, repo, pullNumber, options) =>
			HttpClientRequest.get(
				`/repos/${owner}/${repo}/pulls/${pullNumber}/comments`,
			).pipe(
				HttpClientRequest.setUrlParams({
					sort: options?.["sort"] as any,
					direction: options?.["direction"] as any,
					since: options?.["since"] as any,
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(PullsListReviewComments200),
						orElse: unexpectedStatus,
					}),
				),
			),
		pullsListFiles: (owner, repo, pullNumber, options) =>
			HttpClientRequest.get(
				`/repos/${owner}/${repo}/pulls/${pullNumber}/files`,
			).pipe(
				HttpClientRequest.setUrlParams({
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(PullsListFiles200),
						"422": decodeError("ValidationError", ValidationError),
						"500": decodeError("BasicError", BasicError),
						"503": decodeError("PullsListFiles503", PullsListFiles503),
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesListForRepo: (owner, repo, options) =>
			HttpClientRequest.get(`/repos/${owner}/${repo}/issues`).pipe(
				HttpClientRequest.setUrlParams({
					milestone: options?.["milestone"] as any,
					state: options?.["state"] as any,
					assignee: options?.["assignee"] as any,
					type: options?.["type"] as any,
					creator: options?.["creator"] as any,
					mentioned: options?.["mentioned"] as any,
					labels: options?.["labels"] as any,
					sort: options?.["sort"] as any,
					direction: options?.["direction"] as any,
					since: options?.["since"] as any,
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"200": decodeSuccess(IssuesListForRepo200),
						"301": decodeSuccess(BasicError),
						"404": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationError", ValidationError),
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesCreate: (owner, repo, options) =>
			HttpClientRequest.post(`/repos/${owner}/${repo}/issues`).pipe(
				HttpClientRequest.bodyUnsafeJson(options.payload),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(Issue),
						"400": decodeError("BasicError", BasicError),
						"403": decodeError("BasicError", BasicError),
						"404": decodeError("BasicError", BasicError),
						"410": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationError", ValidationError),
						"503": decodeError("IssuesCreate503", IssuesCreate503),
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesGet: (owner, repo, issueNumber, options) =>
			HttpClientRequest.get(
				`/repos/${owner}/${repo}/issues/${issueNumber}`,
			).pipe(
				withResponse(
					HttpClientResponse.matchStatus({
						"200": decodeSuccess(Issue),
						"301": decodeSuccess(BasicError),
						"404": decodeError("BasicError", BasicError),
						"410": decodeError("BasicError", BasicError),
						"304": () => Effect.void,
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesUpdate: (owner, repo, issueNumber, options) =>
			HttpClientRequest.patch(
				`/repos/${owner}/${repo}/issues/${issueNumber}`,
			).pipe(
				HttpClientRequest.bodyUnsafeJson(options.payload),
				withResponse(
					HttpClientResponse.matchStatus({
						"200": decodeSuccess(Issue),
						"301": decodeSuccess(BasicError),
						"403": decodeError("BasicError", BasicError),
						"404": decodeError("BasicError", BasicError),
						"410": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationError", ValidationError),
						"503": decodeError("IssuesUpdate503", IssuesUpdate503),
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesListComments: (owner, repo, issueNumber, options) =>
			HttpClientRequest.get(
				`/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
			).pipe(
				HttpClientRequest.setUrlParams({
					since: options?.["since"] as any,
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(IssuesListComments200),
						"404": decodeError("BasicError", BasicError),
						"410": decodeError("BasicError", BasicError),
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesCreateComment: (owner, repo, issueNumber, options) =>
			HttpClientRequest.post(
				`/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
			).pipe(
				HttpClientRequest.bodyUnsafeJson(options.payload),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(IssueComment),
						"403": decodeError("BasicError", BasicError),
						"404": decodeError("BasicError", BasicError),
						"410": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationError", ValidationError),
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesListLabelsOnIssue: (owner, repo, issueNumber, options) =>
			HttpClientRequest.get(
				`/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
			).pipe(
				HttpClientRequest.setUrlParams({
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"200": decodeSuccess(IssuesListLabelsOnIssue200),
						"301": decodeSuccess(BasicError),
						"404": decodeError("BasicError", BasicError),
						"410": decodeError("BasicError", BasicError),
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesAddLabels: (owner, repo, issueNumber, options) =>
			HttpClientRequest.post(
				`/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
			).pipe(
				HttpClientRequest.bodyUnsafeJson(options.payload),
				withResponse(
					HttpClientResponse.matchStatus({
						"200": decodeSuccess(IssuesAddLabels200),
						"301": decodeSuccess(BasicError),
						"404": decodeError("BasicError", BasicError),
						"410": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationError", ValidationError),
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesRemoveLabel: (owner, repo, issueNumber, name, options) =>
			HttpClientRequest.del(
				`/repos/${owner}/${repo}/issues/${issueNumber}/labels/${name}`,
			).pipe(
				withResponse(
					HttpClientResponse.matchStatus({
						"200": decodeSuccess(IssuesRemoveLabel200),
						"301": decodeSuccess(BasicError),
						"404": decodeError("BasicError", BasicError),
						"410": decodeError("BasicError", BasicError),
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesAddAssignees: (owner, repo, issueNumber, options) =>
			HttpClientRequest.post(
				`/repos/${owner}/${repo}/issues/${issueNumber}/assignees`,
			).pipe(
				HttpClientRequest.bodyUnsafeJson(options.payload),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(Issue),
						orElse: unexpectedStatus,
					}),
				),
			),
		issuesRemoveAssignees: (owner, repo, issueNumber, options) =>
			HttpClientRequest.del(
				`/repos/${owner}/${repo}/issues/${issueNumber}/assignees`,
			).pipe(
				HttpClientRequest.bodyUnsafeJson(options.payload),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(Issue),
						orElse: unexpectedStatus,
					}),
				),
			),
		reposListCommits: (owner, repo, options) =>
			HttpClientRequest.get(`/repos/${owner}/${repo}/commits`).pipe(
				HttpClientRequest.setUrlParams({
					sha: options?.["sha"] as any,
					path: options?.["path"] as any,
					author: options?.["author"] as any,
					committer: options?.["committer"] as any,
					since: options?.["since"] as any,
					until: options?.["until"] as any,
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(ReposListCommits200),
						"400": decodeError("BasicError", BasicError),
						"404": decodeError("BasicError", BasicError),
						"409": decodeError("BasicError", BasicError),
						"500": decodeError("BasicError", BasicError),
						orElse: unexpectedStatus,
					}),
				),
			),
		checksListForRef: (owner, repo, ref, options) =>
			HttpClientRequest.get(
				`/repos/${owner}/${repo}/commits/${ref}/check-runs`,
			).pipe(
				HttpClientRequest.setUrlParams({
					check_name: options?.["check_name"] as any,
					status: options?.["status"] as any,
					filter: options?.["filter"] as any,
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
					app_id: options?.["app_id"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(ChecksListForRef200),
						orElse: unexpectedStatus,
					}),
				),
			),
		actionsListWorkflowRunsForRepo: (owner, repo, options) =>
			HttpClientRequest.get(`/repos/${owner}/${repo}/actions/runs`).pipe(
				HttpClientRequest.setUrlParams({
					actor: options?.["actor"] as any,
					branch: options?.["branch"] as any,
					event: options?.["event"] as any,
					status: options?.["status"] as any,
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
					created: options?.["created"] as any,
					exclude_pull_requests: options?.["exclude_pull_requests"] as any,
					check_suite_id: options?.["check_suite_id"] as any,
					head_sha: options?.["head_sha"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(ActionsListWorkflowRunsForRepo200),
						orElse: unexpectedStatus,
					}),
				),
			),
		actionsListJobsForWorkflowRun: (owner, repo, runId, options) =>
			HttpClientRequest.get(
				`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
			).pipe(
				HttpClientRequest.setUrlParams({
					filter: options?.["filter"] as any,
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(ActionsListJobsForWorkflowRun200),
						orElse: unexpectedStatus,
					}),
				),
			),
		gitGetTree: (owner, repo, treeSha, options) =>
			HttpClientRequest.get(
				`/repos/${owner}/${repo}/git/trees/${treeSha}`,
			).pipe(
				HttpClientRequest.setUrlParams({
					recursive: options?.["recursive"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(GitTree),
						"404": decodeError("BasicError", BasicError),
						"409": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationError", ValidationError),
						orElse: unexpectedStatus,
					}),
				),
			),
		reposGetContent: (owner, repo, path, options) =>
			HttpClientRequest.get(`/repos/${owner}/${repo}/contents/${path}`).pipe(
				HttpClientRequest.setUrlParams({ ref: options?.["ref"] as any }),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(ReposGetContent200),
						"403": decodeError("BasicError", BasicError),
						"404": decodeError("BasicError", BasicError),
						"302": () => Effect.void,
						"304": () => Effect.void,
						orElse: unexpectedStatus,
					}),
				),
			),
		reposCreateWebhook: (owner, repo, options) =>
			HttpClientRequest.post(`/repos/${owner}/${repo}/hooks`).pipe(
				HttpClientRequest.bodyUnsafeJson(options.payload),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(Hook),
						"403": decodeError("BasicError", BasicError),
						"404": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationError", ValidationError),
						orElse: unexpectedStatus,
					}),
				),
			),
		activityListNotificationsForAuthenticatedUser: (options) =>
			HttpClientRequest.get(`/notifications`).pipe(
				HttpClientRequest.setUrlParams({
					all: options?.["all"] as any,
					participating: options?.["participating"] as any,
					since: options?.["since"] as any,
					before: options?.["before"] as any,
					page: options?.["page"] as any,
					per_page: options?.["per_page"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(
							ActivityListNotificationsForAuthenticatedUser200,
						),
						"401": decodeError("BasicError", BasicError),
						"403": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationError", ValidationError),
						"304": () => Effect.void,
						orElse: unexpectedStatus,
					}),
				),
			),
		activityMarkThreadAsRead: (threadId, options) =>
			HttpClientRequest.patch(`/notifications/threads/${threadId}`).pipe(
				withResponse(
					HttpClientResponse.matchStatus({
						"403": decodeError("BasicError", BasicError),
						"205": () => Effect.void,
						"304": () => Effect.void,
						orElse: unexpectedStatus,
					}),
				),
			),
		reposListForAuthenticatedUser: (options) =>
			HttpClientRequest.get(`/user/repos`).pipe(
				HttpClientRequest.setUrlParams({
					visibility: options?.["visibility"] as any,
					affiliation: options?.["affiliation"] as any,
					type: options?.["type"] as any,
					sort: options?.["sort"] as any,
					direction: options?.["direction"] as any,
					per_page: options?.["per_page"] as any,
					page: options?.["page"] as any,
					since: options?.["since"] as any,
					before: options?.["before"] as any,
				}),
				withResponse(
					HttpClientResponse.matchStatus({
						"2xx": decodeSuccess(ReposListForAuthenticatedUser200),
						"401": decodeError("BasicError", BasicError),
						"403": decodeError("BasicError", BasicError),
						"422": decodeError("ValidationError", ValidationError),
						"304": () => Effect.void,
						orElse: unexpectedStatus,
					}),
				),
			),
	};
};

export interface GitHubClient {
	readonly httpClient: HttpClient.HttpClient;
	/**
	 * Creates an installation access token that enables a GitHub App to make authenticated API requests for the app's installation on an organization or individual account. Installation tokens expire one hour from the time you create them. Using an expired token produces a status code of `401 - Unauthorized`, and requires creating a new installation token. By default the installation token has access to all repositories that the installation can access.
	 *
	 * Optionally, you can use the `repositories` or `repository_ids` body parameters to specify individual repositories that the installation access token can access. If you don't use `repositories` or `repository_ids` to grant access to specific repositories, the installation access token will have access to all repositories that the installation was granted access to. The installation access token cannot be granted access to repositories that the installation was not granted access to. Up to 500 repositories can be listed in this manner.
	 *
	 * Optionally, use the `permissions` body parameter to specify the permissions that the installation access token should have. If `permissions` is not specified, the installation access token will have all of the permissions that were granted to the app. The installation access token cannot be granted permissions that the app was not granted.
	 *
	 * You must use a [JWT](https://docs.github.com/apps/building-github-apps/authenticating-with-github-apps/#authenticating-as-a-github-app) to access this endpoint.
	 */
	readonly appsCreateInstallationAccessToken: (
		installationId: string,
		options: {
			readonly params?:
				| typeof AppsCreateInstallationAccessTokenParams.Encoded
				| undefined;
			readonly payload: typeof AppsCreateInstallationAccessTokenRequest.Encoded;
		},
	) => Effect.Effect<
		typeof InstallationToken.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
	>;
	/**
	 * The `parent` and `source` objects are present when the repository is a fork. `parent` is the repository this repository was forked from, `source` is the ultimate source for the network.
	 *
	 * > [!NOTE]
	 * > - In order to see the `security_and_analysis` block for a repository you must have admin permissions for the repository or be an owner or security manager for the organization that owns the repository. For more information, see "[Managing security managers in your organization](https://docs.github.com/organizations/managing-peoples-access-to-your-organization-with-roles/managing-security-managers-in-your-organization)."
	 * > - To view merge-related settings, you must have the `contents:read` and `contents:write` permissions.
	 */
	readonly reposGet: (
		owner: string,
		repo: string,
		options?: typeof ReposGetParams.Encoded | undefined,
	) => Effect.Effect<
		typeof FullRepository.Type | typeof BasicError.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
	>;
	/**
	 * List branches
	 */
	readonly reposListBranches: (
		owner: string,
		repo: string,
		options?: typeof ReposListBranchesParams.Encoded | undefined,
	) => Effect.Effect<
		typeof ReposListBranches200.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
	>;
	/**
	 * Lists pull requests in a specified repository.
	 *
	 * Draft pull requests are available in public repositories with GitHub
	 * Free and GitHub Free for organizations, GitHub Pro, and legacy per-repository billing
	 * plans, and in public and private repositories with GitHub Team and GitHub Enterprise
	 * Cloud. For more information, see [GitHub's products](https://docs.github.com/github/getting-started-with-github/githubs-products)
	 * in the GitHub Help documentation.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly pullsList: (
		owner: string,
		repo: string,
		options?: typeof PullsListParams.Encoded | undefined,
	) => Effect.Effect<
		typeof PullsList200.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
	>;
	/**
	 * Draft pull requests are available in public repositories with GitHub Free and GitHub Free for organizations, GitHub Pro, and legacy per-repository billing plans, and in public and private repositories with GitHub Team and GitHub Enterprise Cloud. For more information, see [GitHub's products](https://docs.github.com/github/getting-started-with-github/githubs-products) in the GitHub Help documentation.
	 *
	 * Lists details of a pull request by providing its number.
	 *
	 * When you get, [create](https://docs.github.com/rest/pulls/pulls/#create-a-pull-request), or [edit](https://docs.github.com/rest/pulls/pulls#update-a-pull-request) a pull request, GitHub creates a merge commit to test whether the pull request can be automatically merged into the base branch. This test commit is not added to the base branch or the head branch. You can review the status of the test commit using the `mergeable` key. For more information, see "[Checking mergeability of pull requests](https://docs.github.com/rest/guides/getting-started-with-the-git-database-api#checking-mergeability-of-pull-requests)".
	 *
	 * The value of the `mergeable` attribute can be `true`, `false`, or `null`. If the value is `null`, then GitHub has started a background job to compute the mergeability. After giving the job time to complete, resubmit the request. When the job finishes, you will see a non-`null` value for the `mergeable` attribute in the response. If `mergeable` is `true`, then `merge_commit_sha` will be the SHA of the _test_ merge commit.
	 *
	 * The value of the `merge_commit_sha` attribute changes depending on the state of the pull request. Before merging a pull request, the `merge_commit_sha` attribute holds the SHA of the _test_ merge commit. After merging a pull request, the `merge_commit_sha` attribute changes depending on how you merged the pull request:
	 *
	 * *   If merged as a [merge commit](https://docs.github.com/articles/about-merge-methods-on-github/), `merge_commit_sha` represents the SHA of the merge commit.
	 * *   If merged via a [squash](https://docs.github.com/articles/about-merge-methods-on-github/#squashing-your-merge-commits), `merge_commit_sha` represents the SHA of the squashed commit on the base branch.
	 * *   If [rebased](https://docs.github.com/articles/about-merge-methods-on-github/#rebasing-and-merging-your-commits), `merge_commit_sha` represents the commit that the base branch was updated to.
	 *
	 * Pass the appropriate [media type](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types) to fetch diff and patch formats.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 * - **`application/vnd.github.diff`**: For more information, see "[git-diff](https://git-scm.com/docs/git-diff)" in the Git documentation. If a diff is corrupt, contact us through the [GitHub Support portal](https://support.github.com/). Include the repository name and pull request ID in your message.
	 */
	readonly pullsGet: (
		owner: string,
		repo: string,
		pullNumber: string,
		options?: typeof PullsGetParams.Encoded | undefined,
	) => Effect.Effect<
		typeof PullRequest.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"PullsGet503", typeof PullsGet503.Type>
	>;
	/**
	 * Merges a pull request into the base branch.
	 * This endpoint triggers [notifications](https://docs.github.com/github/managing-subscriptions-and-notifications-on-github/about-notifications). Creating content too quickly using this endpoint may result in secondary rate limiting. For more information, see "[Rate limits for the API](https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits)" and "[Best practices for using the REST API](https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api)."
	 */
	readonly pullsMerge: (
		owner: string,
		repo: string,
		pullNumber: string,
		options: {
			readonly params?: typeof PullsMergeParams.Encoded | undefined;
			readonly payload: typeof PullsMergeRequest.Encoded;
		},
	) => Effect.Effect<
		typeof PullRequestMergeResult.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"PullsMerge405", typeof PullsMerge405.Type>
		| GitHubClientError<"PullsMerge409", typeof PullsMerge409.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
	>;
	/**
	 * Lists all reviews for a specified pull request. The list of reviews returns in chronological order.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github-commitcomment.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github-commitcomment.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github-commitcomment.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github-commitcomment.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly pullsListReviews: (
		owner: string,
		repo: string,
		pullNumber: string,
		options?: typeof PullsListReviewsParams.Encoded | undefined,
	) => Effect.Effect<
		typeof PullsListReviews200.Type,
		HttpClientError.HttpClientError | ParseError
	>;
	/**
	 * Creates a review on a specified pull request.
	 *
	 * This endpoint triggers [notifications](https://docs.github.com/github/managing-subscriptions-and-notifications-on-github/about-notifications). Creating content too quickly using this endpoint may result in secondary rate limiting. For more information, see "[Rate limits for the API](https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits)" and "[Best practices for using the REST API](https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api)."
	 *
	 * Pull request reviews created in the `PENDING` state are not submitted and therefore do not include the `submitted_at` property in the response. To create a pending review for a pull request, leave the `event` parameter blank. For more information about submitting a `PENDING` review, see "[Submit a review for a pull request](https://docs.github.com/rest/pulls/reviews#submit-a-review-for-a-pull-request)."
	 *
	 * > [!NOTE]
	 * > To comment on a specific line in a file, you need to first determine the position of that line in the diff. To see a pull request diff, add the `application/vnd.github.v3.diff` media type to the `Accept` header of a call to the [Get a pull request](https://docs.github.com/rest/pulls/pulls#get-a-pull-request) endpoint.
	 *
	 * The `position` value equals the number of lines down from the first "@@" hunk header in the file you want to add a comment. The line just below the "@@" line is position 1, the next line is position 2, and so on. The position in the diff continues to increase through lines of whitespace and additional hunks until the beginning of a new file.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github-commitcomment.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github-commitcomment.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github-commitcomment.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github-commitcomment.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly pullsCreateReview: (
		owner: string,
		repo: string,
		pullNumber: string,
		options: {
			readonly params?: typeof PullsCreateReviewParams.Encoded | undefined;
			readonly payload: typeof PullsCreateReviewRequest.Encoded;
		},
	) => Effect.Effect<
		typeof PullRequestReview.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<
				"ValidationErrorSimple",
				typeof ValidationErrorSimple.Type
		  >
	>;
	/**
	 * Lists all review comments for a specified pull request. By default, review comments
	 * are in ascending order by ID.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github-commitcomment.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github-commitcomment.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github-commitcomment.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github-commitcomment.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly pullsListReviewComments: (
		owner: string,
		repo: string,
		pullNumber: string,
		options?: typeof PullsListReviewCommentsParams.Encoded | undefined,
	) => Effect.Effect<
		typeof PullsListReviewComments200.Type,
		HttpClientError.HttpClientError | ParseError
	>;
	/**
	 * Lists the files in a specified pull request.
	 *
	 * > [!NOTE]
	 * > Responses include a maximum of 3000 files. The paginated response returns 30 files per page by default.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly pullsListFiles: (
		owner: string,
		repo: string,
		pullNumber: string,
		options?: typeof PullsListFilesParams.Encoded | undefined,
	) => Effect.Effect<
		typeof PullsListFiles200.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"PullsListFiles503", typeof PullsListFiles503.Type>
	>;
	/**
	 * List issues in a repository. Only open issues will be listed.
	 *
	 * > [!NOTE]
	 * > GitHub's REST API considers every pull request an issue, but not every issue is a pull request. For this reason, "Issues" endpoints may return both issues and pull requests in the response. You can identify pull requests by the `pull_request` key. Be aware that the `id` of a pull request returned from "Issues" endpoints will be an _issue id_. To find out the pull request id, use the "[List pull requests](https://docs.github.com/rest/pulls/pulls#list-pull-requests)" endpoint.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly issuesListForRepo: (
		owner: string,
		repo: string,
		options?: typeof IssuesListForRepoParams.Encoded | undefined,
	) => Effect.Effect<
		typeof IssuesListForRepo200.Type | typeof BasicError.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
	>;
	/**
	 * Any user with pull access to a repository can create an issue. If [issues are disabled in the repository](https://docs.github.com/articles/disabling-issues/), the API returns a `410 Gone` status.
	 *
	 * This endpoint triggers [notifications](https://docs.github.com/github/managing-subscriptions-and-notifications-on-github/about-notifications). Creating content too quickly using this endpoint may result in secondary rate limiting. For more information, see "[Rate limits for the API](https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits)"
	 * and "[Best practices for using the REST API](https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api)."
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly issuesCreate: (
		owner: string,
		repo: string,
		options: {
			readonly params?: typeof IssuesCreateParams.Encoded | undefined;
			readonly payload: typeof IssuesCreateRequest.Encoded;
		},
	) => Effect.Effect<
		typeof Issue.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
		| GitHubClientError<"IssuesCreate503", typeof IssuesCreate503.Type>
	>;
	/**
	 * The API returns a [`301 Moved Permanently` status](https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api#follow-redirects) if the issue was
	 * [transferred](https://docs.github.com/articles/transferring-an-issue-to-another-repository/) to another repository. If
	 * the issue was transferred to or deleted from a repository where the authenticated user lacks read access, the API
	 * returns a `404 Not Found` status. If the issue was deleted from a repository where the authenticated user has read
	 * access, the API returns a `410 Gone` status. To receive webhook events for transferred and deleted issues, subscribe
	 * to the [`issues`](https://docs.github.com/webhooks/event-payloads/#issues) webhook.
	 *
	 * > [!NOTE]
	 * > GitHub's REST API considers every pull request an issue, but not every issue is a pull request. For this reason, "Issues" endpoints may return both issues and pull requests in the response. You can identify pull requests by the `pull_request` key. Be aware that the `id` of a pull request returned from "Issues" endpoints will be an _issue id_. To find out the pull request id, use the "[List pull requests](https://docs.github.com/rest/pulls/pulls#list-pull-requests)" endpoint.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly issuesGet: (
		owner: string,
		repo: string,
		issueNumber: string,
		options?: typeof IssuesGetParams.Encoded | undefined,
	) => Effect.Effect<
		typeof Issue.Type | typeof BasicError.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
	>;
	/**
	 * Issue owners and users with push access or Triage role can edit an issue.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly issuesUpdate: (
		owner: string,
		repo: string,
		issueNumber: string,
		options: {
			readonly params?: typeof IssuesUpdateParams.Encoded | undefined;
			readonly payload: typeof IssuesUpdateRequest.Encoded;
		},
	) => Effect.Effect<
		typeof Issue.Type | typeof BasicError.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
		| GitHubClientError<"IssuesUpdate503", typeof IssuesUpdate503.Type>
	>;
	/**
	 * You can use the REST API to list comments on issues and pull requests. Every pull request is an issue, but not every issue is a pull request.
	 *
	 * Issue comments are ordered by ascending ID.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly issuesListComments: (
		owner: string,
		repo: string,
		issueNumber: string,
		options?: typeof IssuesListCommentsParams.Encoded | undefined,
	) => Effect.Effect<
		typeof IssuesListComments200.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
	>;
	/**
	 * You can use the REST API to create comments on issues and pull requests. Every pull request is an issue, but not every issue is a pull request.
	 *
	 * This endpoint triggers [notifications](https://docs.github.com/github/managing-subscriptions-and-notifications-on-github/about-notifications).
	 * Creating content too quickly using this endpoint may result in secondary rate limiting.
	 * For more information, see "[Rate limits for the API](https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits)"
	 * and "[Best practices for using the REST API](https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api)."
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github.raw+json`**: Returns the raw markdown body. Response will include `body`. This is the default if you do not pass any specific media type.
	 * - **`application/vnd.github.text+json`**: Returns a text only representation of the markdown body. Response will include `body_text`.
	 * - **`application/vnd.github.html+json`**: Returns HTML rendered from the body's markdown. Response will include `body_html`.
	 * - **`application/vnd.github.full+json`**: Returns raw, text, and HTML representations. Response will include `body`, `body_text`, and `body_html`.
	 */
	readonly issuesCreateComment: (
		owner: string,
		repo: string,
		issueNumber: string,
		options: {
			readonly params?: typeof IssuesCreateCommentParams.Encoded | undefined;
			readonly payload: typeof IssuesCreateCommentRequest.Encoded;
		},
	) => Effect.Effect<
		typeof IssueComment.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
	>;
	/**
	 * Lists all labels for an issue.
	 */
	readonly issuesListLabelsOnIssue: (
		owner: string,
		repo: string,
		issueNumber: string,
		options?: typeof IssuesListLabelsOnIssueParams.Encoded | undefined,
	) => Effect.Effect<
		typeof IssuesListLabelsOnIssue200.Type | typeof BasicError.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
	>;
	/**
	 * Adds labels to an issue.
	 */
	readonly issuesAddLabels: (
		owner: string,
		repo: string,
		issueNumber: string,
		options: {
			readonly params?: typeof IssuesAddLabelsParams.Encoded | undefined;
			readonly payload: typeof IssuesAddLabelsRequest.Encoded;
		},
	) => Effect.Effect<
		typeof IssuesAddLabels200.Type | typeof BasicError.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
	>;
	/**
	 * Removes the specified label from the issue, and returns the remaining labels on the issue. This endpoint returns a `404 Not Found` status if the label does not exist.
	 */
	readonly issuesRemoveLabel: (
		owner: string,
		repo: string,
		issueNumber: string,
		name: string,
		options?: typeof IssuesRemoveLabelParams.Encoded | undefined,
	) => Effect.Effect<
		typeof IssuesRemoveLabel200.Type | typeof BasicError.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
	>;
	/**
	 * Adds up to 10 assignees to an issue. Users already assigned to an issue are not replaced.
	 */
	readonly issuesAddAssignees: (
		owner: string,
		repo: string,
		issueNumber: string,
		options: {
			readonly params?: typeof IssuesAddAssigneesParams.Encoded | undefined;
			readonly payload: typeof IssuesAddAssigneesRequest.Encoded;
		},
	) => Effect.Effect<
		typeof Issue.Type,
		HttpClientError.HttpClientError | ParseError
	>;
	/**
	 * Removes one or more assignees from an issue.
	 */
	readonly issuesRemoveAssignees: (
		owner: string,
		repo: string,
		issueNumber: string,
		options: {
			readonly params?: typeof IssuesRemoveAssigneesParams.Encoded | undefined;
			readonly payload: typeof IssuesRemoveAssigneesRequest.Encoded;
		},
	) => Effect.Effect<
		typeof Issue.Type,
		HttpClientError.HttpClientError | ParseError
	>;
	/**
	 * **Signature verification object**
	 *
	 * The response will include a `verification` object that describes the result of verifying the commit's signature. The following fields are included in the `verification` object:
	 *
	 * | Name | Type | Description |
	 * | ---- | ---- | ----------- |
	 * | `verified` | `boolean` | Indicates whether GitHub considers the signature in this commit to be verified. |
	 * | `reason` | `string` | The reason for verified value. Possible values and their meanings are enumerated in table below. |
	 * | `signature` | `string` | The signature that was extracted from the commit. |
	 * | `payload` | `string` | The value that was signed. |
	 * | `verified_at` | `string` | The date the signature was verified by GitHub. |
	 *
	 * These are the possible values for `reason` in the `verification` object:
	 *
	 * | Value | Description |
	 * | ----- | ----------- |
	 * | `expired_key` | The key that made the signature is expired. |
	 * | `not_signing_key` | The "signing" flag is not among the usage flags in the GPG key that made the signature. |
	 * | `gpgverify_error` | There was an error communicating with the signature verification service. |
	 * | `gpgverify_unavailable` | The signature verification service is currently unavailable. |
	 * | `unsigned` | The object does not include a signature. |
	 * | `unknown_signature_type` | A non-PGP signature was found in the commit. |
	 * | `no_user` | No user was associated with the `committer` email address in the commit. |
	 * | `unverified_email` | The `committer` email address in the commit was associated with a user, but the email address is not verified on their account. |
	 * | `bad_email` | The `committer` email address in the commit is not included in the identities of the PGP key that made the signature. |
	 * | `unknown_key` | The key that made the signature has not been registered with any user's account. |
	 * | `malformed_signature` | There was an error parsing the signature. |
	 * | `invalid` | The signature could not be cryptographically verified using the key whose key-id was found in the signature. |
	 * | `valid` | None of the above errors applied, so the signature is considered to be verified. |
	 */
	readonly reposListCommits: (
		owner: string,
		repo: string,
		options?: typeof ReposListCommitsParams.Encoded | undefined,
	) => Effect.Effect<
		typeof ReposListCommits200.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
	>;
	/**
	 * Lists check runs for a commit ref. The `ref` can be a SHA, branch name, or a tag name.
	 *
	 * > [!NOTE]
	 * > The endpoints to manage checks only look for pushes in the repository where the check suite or check run were created. Pushes to a branch in a forked repository are not detected and return an empty `pull_requests` array.
	 *
	 * If there are more than 1000 check suites on a single git reference, this endpoint will limit check runs to the 1000 most recent check suites. To iterate over all possible check runs, use the [List check suites for a Git reference](https://docs.github.com/rest/reference/checks#list-check-suites-for-a-git-reference) endpoint and provide the `check_suite_id` parameter to the [List check runs in a check suite](https://docs.github.com/rest/reference/checks#list-check-runs-in-a-check-suite) endpoint.
	 *
	 * OAuth app tokens and personal access tokens (classic) need the `repo` scope to use this endpoint on a private repository.
	 */
	readonly checksListForRef: (
		owner: string,
		repo: string,
		ref: string,
		options?: typeof ChecksListForRefParams.Encoded | undefined,
	) => Effect.Effect<
		typeof ChecksListForRef200.Type,
		HttpClientError.HttpClientError | ParseError
	>;
	/**
	 * Lists all workflow runs for a repository. You can use parameters to narrow the list of results. For more information about using parameters, see [Parameters](https://docs.github.com/rest/guides/getting-started-with-the-rest-api#parameters).
	 *
	 * Anyone with read access to the repository can use this endpoint.
	 *
	 * OAuth app tokens and personal access tokens (classic) need the `repo` scope to use this endpoint with a private repository.
	 *
	 * This endpoint will return up to 1,000 results for each search when using the following parameters: `actor`, `branch`, `check_suite_id`, `created`, `event`, `head_sha`, `status`.
	 */
	readonly actionsListWorkflowRunsForRepo: (
		owner: string,
		repo: string,
		options?: typeof ActionsListWorkflowRunsForRepoParams.Encoded | undefined,
	) => Effect.Effect<
		typeof ActionsListWorkflowRunsForRepo200.Type,
		HttpClientError.HttpClientError | ParseError
	>;
	/**
	 * Lists jobs for a workflow run. You can use parameters to narrow the list of results. For more information
	 * about using parameters, see [Parameters](https://docs.github.com/rest/guides/getting-started-with-the-rest-api#parameters).
	 *
	 * Anyone with read access to the repository can use this endpoint.
	 *
	 * OAuth app tokens and personal access tokens (classic) need the `repo` scope to use this endpoint with a private repository.
	 */
	readonly actionsListJobsForWorkflowRun: (
		owner: string,
		repo: string,
		runId: string,
		options?: typeof ActionsListJobsForWorkflowRunParams.Encoded | undefined,
	) => Effect.Effect<
		typeof ActionsListJobsForWorkflowRun200.Type,
		HttpClientError.HttpClientError | ParseError
	>;
	/**
	 * Returns a single tree using the SHA1 value or ref name for that tree.
	 *
	 * If `truncated` is `true` in the response then the number of items in the `tree` array exceeded our maximum limit. If you need to fetch more items, use the non-recursive method of fetching trees, and fetch one sub-tree at a time.
	 *
	 * > [!NOTE]
	 * > The limit for the `tree` array is 100,000 entries with a maximum size of 7 MB when using the `recursive` parameter.
	 */
	readonly gitGetTree: (
		owner: string,
		repo: string,
		treeSha: string,
		options?: typeof GitGetTreeParams.Encoded | undefined,
	) => Effect.Effect<
		typeof GitTree.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
	>;
	/**
	 * Gets the contents of a file or directory in a repository. Specify the file path or directory with the `path` parameter. If you omit the `path` parameter, you will receive the contents of the repository's root directory.
	 *
	 * This endpoint supports the following custom media types. For more information, see "[Media types](https://docs.github.com/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types)."
	 *
	 * - **`application/vnd.github.raw+json`**: Returns the raw file contents for files and symlinks.
	 * - **`application/vnd.github.html+json`**: Returns the file contents in HTML. Markup languages are rendered to HTML using GitHub's open-source [Markup library](https://github.com/github/markup).
	 * - **`application/vnd.github.object+json`**: Returns the contents in a consistent object format regardless of the content type. For example, instead of an array of objects for a directory, the response will be an object with an `entries` attribute containing the array of objects.
	 *
	 * If the content is a directory, the response will be an array of objects, one object for each item in the directory. When listing the contents of a directory, submodules have their "type" specified as "file". Logically, the value _should_ be "submodule". This behavior exists [for backwards compatibility purposes](https://git.io/v1YCW). In the next major version of the API, the type will be returned as "submodule".
	 *
	 * If the content is a symlink and the symlink's target is a normal file in the repository, then the API responds with the content of the file. Otherwise, the API responds with an object describing the symlink itself.
	 *
	 * If the content is a submodule, the `submodule_git_url` field identifies the location of the submodule repository, and the `sha` identifies a specific commit within the submodule repository. Git uses the given URL when cloning the submodule repository, and checks out the submodule at that specific commit. If the submodule repository is not hosted on github.com, the Git URLs (`git_url` and `_links["git"]`) and the github.com URLs (`html_url` and `_links["html"]`) will have null values.
	 *
	 * **Notes**:
	 *
	 * - To get a repository's contents recursively, you can [recursively get the tree](https://docs.github.com/rest/git/trees#get-a-tree).
	 * - This API has an upper limit of 1,000 files for a directory. If you need to retrieve
	 * more files, use the [Git Trees API](https://docs.github.com/rest/git/trees#get-a-tree).
	 * - Download URLs expire and are meant to be used just once. To ensure the download URL does not expire, please use the contents API to obtain a fresh download URL for each download.
	 * - If the requested file's size is:
	 *   - 1 MB or smaller: All features of this endpoint are supported.
	 *   - Between 1-100 MB: Only the `raw` or `object` custom media types are supported. Both will work as normal, except that when using the `object` media type, the `content` field will be an empty
	 * string and the `encoding` field will be `"none"`. To get the contents of these larger files, use the `raw` media type.
	 *   - Greater than 100 MB: This endpoint is not supported.
	 */
	readonly reposGetContent: (
		owner: string,
		repo: string,
		path: string,
		options?: typeof ReposGetContentParams.Encoded | undefined,
	) => Effect.Effect<
		typeof ReposGetContent200.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
	>;
	/**
	 * Repositories can have multiple webhooks installed. Each webhook should have a unique `config`. Multiple webhooks can
	 * share the same `config` as long as those webhooks do not have any `events` that overlap.
	 */
	readonly reposCreateWebhook: (
		owner: string,
		repo: string,
		options: {
			readonly params?: typeof ReposCreateWebhookParams.Encoded | undefined;
			readonly payload: typeof ReposCreateWebhookRequest.Encoded;
		},
	) => Effect.Effect<
		typeof Hook.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
	>;
	/**
	 * List all notifications for the current user, sorted by most recently updated.
	 */
	readonly activityListNotificationsForAuthenticatedUser: (
		options?:
			| typeof ActivityListNotificationsForAuthenticatedUserParams.Encoded
			| undefined,
	) => Effect.Effect<
		typeof ActivityListNotificationsForAuthenticatedUser200.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
	>;
	/**
	 * Marks a thread as "read." Marking a thread as "read" is equivalent to clicking a notification in your notification inbox on GitHub: https://github.com/notifications.
	 */
	readonly activityMarkThreadAsRead: (
		threadId: string,
		options?: typeof ActivityMarkThreadAsReadParams.Encoded | undefined,
	) => Effect.Effect<
		void,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
	>;
	/**
	 * Lists repositories that the authenticated user has explicit permission (`:read`, `:write`, or `:admin`) to access.
	 *
	 * The authenticated user has explicit permission to access repositories they own, repositories where they are a collaborator, and repositories that they can access through an organization membership.
	 */
	readonly reposListForAuthenticatedUser: (
		options?: typeof ReposListForAuthenticatedUserParams.Encoded | undefined,
	) => Effect.Effect<
		typeof ReposListForAuthenticatedUser200.Type,
		| HttpClientError.HttpClientError
		| ParseError
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"BasicError", typeof BasicError.Type>
		| GitHubClientError<"ValidationError", typeof ValidationError.Type>
	>;
}

export interface GitHubClientError<Tag extends string, E> {
	readonly _tag: Tag;
	readonly request: HttpClientRequest.HttpClientRequest;
	readonly response: HttpClientResponse.HttpClientResponse;
	readonly cause: E;
}

class GitHubClientErrorImpl extends Data.Error<{
	_tag: string;
	cause: any;
	request: HttpClientRequest.HttpClientRequest;
	response: HttpClientResponse.HttpClientResponse;
}> {}

export const GitHubClientError = <Tag extends string, E>(
	tag: Tag,
	cause: E,
	response: HttpClientResponse.HttpClientResponse,
): GitHubClientError<Tag, E> =>
	new GitHubClientErrorImpl({
		_tag: tag,
		cause,
		response,
		request: response.request,
	}) as any;
