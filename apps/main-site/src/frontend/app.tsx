"use client";

import { Result, useAtomValue } from "@effect-atom/atom-react";
import {
	CircleDot,
	FileCode2,
	GitPullRequest,
	Play,
} from "@packages/ui/components/icons";
import { Skeleton } from "@packages/ui/components/skeleton";
import {
	notifyQuickHubNavigation,
	quickHubNavigateEvent,
	quickHubPrefetchEvent,
} from "@packages/ui/lib/spa-navigation";
import { useCodeBrowse } from "@packages/ui/rpc/code-browse";
import { getNotificationsClient } from "@packages/ui/rpc/notifications";
import { getProjectionQueriesClient } from "@packages/ui/rpc/projection-queries";
import { Option } from "effect";
import { useEffect, useMemo, useState } from "react";
import {
	createBrowserRouter,
	type LoaderFunctionArgs,
	matchRoutes,
	Navigate,
	Outlet,
	RouterProvider,
	useLoaderData,
	useLocation,
	useNavigate,
	useNavigation,
} from "react-router";
import { WorkflowRunDetailClient } from "@/app/(main-site)/@detail/[owner]/[name]/actions/[runNumber]/workflow-run-detail-client";
import { FileViewerMonaco } from "@/app/(main-site)/@detail/[owner]/[name]/code/file-viewer-monaco";
import { IssueDetailClient } from "@/app/(main-site)/@detail/[owner]/[name]/issues/[number]/issue-detail-client";
import { NewIssueClient } from "@/app/(main-site)/@detail/[owner]/[name]/issues/new/new-issue-client";
import { PrDetailClient } from "@/app/(main-site)/@detail/[owner]/[name]/pulls/[number]/pr-detail-client";
import {
	RecentIssuesPanel,
	RecentPrsPanel,
	RepoOverviewHeader,
} from "@/app/(main-site)/@detail/[owner]/[name]/repo-overview-client";
import {
	CommandPaletteClient,
	IssuesColumnClient,
	PrColumnClient,
	ReposColumnClient,
	SignInCta,
} from "@/app/(main-site)/@detail/home-dashboard-client";
import { NotificationsClient } from "@/app/(main-site)/@detail/notifications/notifications-client";
import { FileTreeClient } from "@/app/(main-site)/@sidebar/[owner]/[name]/code/file-tree-client";
import { SidebarClient } from "@/app/(main-site)/@sidebar/sidebar-client";
import { SidebarRepoList } from "@/app/(main-site)/@sidebar/sidebar-repo-list";
import { HubShell } from "@/app/(main-site)/_components/hub-shell";
import { IssueListClient } from "@/app/(main-site)/_components/issue-list-client";
import { PrListClient } from "@/app/(main-site)/_components/pr-list-client";
import { RepoListShell } from "@/app/(main-site)/_components/repo-list-shell";
import { RepoNavSelector } from "@/app/(main-site)/_components/repo-nav-selector";
import { SyncProgressOverlay } from "@/app/(main-site)/_components/sync-progress-client";
import { WorkflowRunListClient } from "@/app/(main-site)/_components/workflow-run-list-client";

if (typeof window !== "undefined") {
	Reflect.set(window, "__quickhubSpa", true);
}

const projectionClient = getProjectionQueriesClient();
const notificationsClient = getNotificationsClient();

const loadRepos = () => projectionClient.listRepos.queryPromise({});

const loadDashboard = (owner: string | null) =>
	owner === null
		? projectionClient.getHomeDashboard.queryPromise({})
		: projectionClient.getHomeDashboard.queryPromise({ ownerLogin: owner });

const loadRepoOverview = (owner: string, name: string) =>
	projectionClient.getRepoOverview.queryPromise({ ownerLogin: owner, name });

const loadPulls = (owner: string, name: string) =>
	projectionClient.listPullRequests.queryPromise({
		ownerLogin: owner,
		name,
		state: "open",
	});

const loadIssues = (owner: string, name: string) =>
	projectionClient.listIssues.queryPromise({
		ownerLogin: owner,
		name,
		state: "open",
	});

const loadPrDetail = (owner: string, name: string, number: number) =>
	projectionClient.getPullRequestDetail.queryPromise({
		ownerLogin: owner,
		name,
		number,
	});

const loadPrFiles = (owner: string, name: string, number: number) =>
	projectionClient.listPrFiles.queryPromise({
		ownerLogin: owner,
		name,
		number,
	});

const loadIssueDetail = (owner: string, name: string, number: number) =>
	projectionClient.getIssueDetail.queryPromise({
		ownerLogin: owner,
		name,
		number,
	});

const loadWorkflowRuns = (owner: string, name: string) =>
	projectionClient.listWorkflowRuns.queryPromise({ ownerLogin: owner, name });

const loadWorkflowRunDetail = (
	owner: string,
	name: string,
	runNumber: number,
) =>
	projectionClient.getWorkflowRunDetail.queryPromise({
		ownerLogin: owner,
		name,
		runNumber,
	});

const loadNotifications = () =>
	notificationsClient.listNotifications.queryPromise({});

const parseNumberParam = (value: string, name: string): number => {
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		throw new Response(`Invalid ${name}`, { status: 400 });
	}
	return parsed;
};

const getParam = (args: LoaderFunctionArgs, key: string): string => {
	const value = args.params[key];
	if (value === undefined) {
		throw new Response(`Missing parameter: ${key}`, { status: 400 });
	}
	return value;
};

const rootLoader = async () => {
	const [initialRepos, initialDashboard] = await Promise.all([
		loadRepos(),
		loadDashboard(null),
	]);
	return { initialRepos, initialDashboard };
};

type RootLoaderData = Awaited<ReturnType<typeof rootLoader>>;

const ownerLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const [initialRepos, initialDashboard] = await Promise.all([
		loadRepos(),
		loadDashboard(owner),
	]);
	return { owner, initialRepos, initialDashboard };
};

type OwnerLoaderData = Awaited<ReturnType<typeof ownerLoader>>;

const repoOverviewLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const name = getParam(args, "name");
	const [initialRepos, initialOverview, initialPrs, initialIssues] =
		await Promise.all([
			loadRepos(),
			loadRepoOverview(owner, name),
			loadPulls(owner, name),
			loadIssues(owner, name),
		]);

	return {
		owner,
		name,
		initialRepos,
		initialOverview,
		initialPrs,
		initialIssues,
	};
};

type RepoOverviewLoaderData = Awaited<ReturnType<typeof repoOverviewLoader>>;

const pullsLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const name = getParam(args, "name");
	const [initialRepos, initialPrs] = await Promise.all([
		loadRepos(),
		loadPulls(owner, name),
	]);

	return { owner, name, initialRepos, initialPrs };
};

type PullsLoaderData = Awaited<ReturnType<typeof pullsLoader>>;

const pullDetailLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const name = getParam(args, "name");
	const prNumber = parseNumberParam(getParam(args, "number"), "pull number");

	const [initialRepos, initialPrs, initialPr, initialFiles] = await Promise.all(
		[
			loadRepos(),
			loadPulls(owner, name),
			loadPrDetail(owner, name, prNumber),
			loadPrFiles(owner, name, prNumber),
		],
	);

	return {
		owner,
		name,
		prNumber,
		initialRepos,
		initialPrs,
		initialPr,
		initialFiles,
	};
};

type PullDetailLoaderData = Awaited<ReturnType<typeof pullDetailLoader>>;

const issuesLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const name = getParam(args, "name");
	const [initialRepos, initialOverview, initialIssues] = await Promise.all([
		loadRepos(),
		loadRepoOverview(owner, name),
		loadIssues(owner, name),
	]);

	return { owner, name, initialRepos, initialOverview, initialIssues };
};

type IssuesLoaderData = Awaited<ReturnType<typeof issuesLoader>>;

const issueDetailLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const name = getParam(args, "name");
	const issueNumber = parseNumberParam(
		getParam(args, "number"),
		"issue number",
	);

	const [initialRepos, initialOverview, initialIssues, initialIssue] =
		await Promise.all([
			loadRepos(),
			loadRepoOverview(owner, name),
			loadIssues(owner, name),
			loadIssueDetail(owner, name, issueNumber),
		]);

	return {
		owner,
		name,
		issueNumber,
		initialRepos,
		initialOverview,
		initialIssues,
		initialIssue,
	};
};

type IssueDetailLoaderData = Awaited<ReturnType<typeof issueDetailLoader>>;

const newIssueLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const name = getParam(args, "name");
	const [initialRepos, initialOverview, initialIssues] = await Promise.all([
		loadRepos(),
		loadRepoOverview(owner, name),
		loadIssues(owner, name),
	]);

	return { owner, name, initialRepos, initialOverview, initialIssues };
};

type NewIssueLoaderData = Awaited<ReturnType<typeof newIssueLoader>>;

const actionsLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const name = getParam(args, "name");
	const [initialRepos, initialRuns] = await Promise.all([
		loadRepos(),
		loadWorkflowRuns(owner, name),
	]);

	return { owner, name, initialRepos, initialRuns };
};

type ActionsLoaderData = Awaited<ReturnType<typeof actionsLoader>>;

const runDetailLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const name = getParam(args, "name");
	const runNumber = parseNumberParam(getParam(args, "runId"), "run number");

	const [initialRepos, initialRuns, initialRun] = await Promise.all([
		loadRepos(),
		loadWorkflowRuns(owner, name),
		loadWorkflowRunDetail(owner, name, runNumber),
	]);

	return {
		owner,
		name,
		runNumber,
		initialRepos,
		initialRuns,
		initialRun,
	};
};

type RunDetailLoaderData = Awaited<ReturnType<typeof runDetailLoader>>;

const notificationsLoader = async () => {
	const [initialRepos, initialNotifications] = await Promise.all([
		loadRepos(),
		loadNotifications(),
	]);

	return { initialRepos, initialNotifications };
};

type NotificationsLoaderData = Awaited<ReturnType<typeof notificationsLoader>>;

const codeLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const name = getParam(args, "name");
	const initialRepos = await loadRepos();
	return { owner, name, initialRepos };
};

type CodeLoaderData = Awaited<ReturnType<typeof codeLoader>>;

const blobLoader = async (args: LoaderFunctionArgs) => {
	const owner = getParam(args, "owner");
	const name = getParam(args, "name");
	const ref = decodeSegment(getParam(args, "ref"));
	const path = decodePath(getParam(args, "*"));
	const initialRepos = await loadRepos();
	return { owner, name, ref, path, initialRepos };
};

type BlobLoaderData = Awaited<ReturnType<typeof blobLoader>>;

type ShellProps = {
	owner: string | null;
	name: string | null;
	initialRepos: Awaited<ReturnType<typeof loadRepos>>;
	activeTab?: string;
	sidebar: React.ReactNode;
	detail: React.ReactNode;
};

function MainSiteShellClient({
	owner,
	name,
	initialRepos,
	activeTab,
	sidebar,
	detail,
}: ShellProps) {
	return (
		<HubShell
			sidebar={
				<SidebarClient
					navSelector={
						<RepoNavSelector
							owner={owner}
							name={name}
							activeTab={activeTab}
							initialRepos={initialRepos}
						/>
					}
				>
					{sidebar}
				</SidebarClient>
			}
			detail={detail}
		/>
	);
}

function DashboardDetail({
	owner,
	initialData,
}: {
	owner: string | null;
	initialData: Awaited<ReturnType<typeof loadDashboard>>;
}) {
	return (
		<div className="h-full overflow-y-auto bg-dotgrid">
			<div className="mx-auto max-w-[1600px] px-4 py-4 md:px-6 md:py-5">
				<div className="mb-4">
					<CommandPaletteClient
						initialData={initialData}
						query={owner === null ? {} : { ownerLogin: owner }}
					/>
				</div>
				<SignInCta />
				<div className="grid gap-4 lg:grid-cols-3">
					<PrColumnClient
						initialData={initialData}
						query={owner === null ? {} : { ownerLogin: owner }}
					/>
					<IssuesColumnClient
						initialData={initialData}
						query={owner === null ? {} : { ownerLogin: owner }}
					/>
					<ReposColumnClient
						initialData={initialData}
						query={owner === null ? {} : { ownerLogin: owner }}
					/>
				</div>
			</div>
		</div>
	);
}

function RepoOverviewDetail({
	owner,
	name,
	initialOverview,
	initialPrs,
	initialIssues,
}: {
	owner: string;
	name: string;
	initialOverview: Awaited<ReturnType<typeof loadRepoOverview>>;
	initialPrs: Awaited<ReturnType<typeof loadPulls>>;
	initialIssues: Awaited<ReturnType<typeof loadIssues>>;
}) {
	return (
		<SyncProgressOverlay owner={owner} name={name}>
			<div className="h-full overflow-y-auto">
				<div className="px-6 py-8">
					<RepoOverviewHeader
						owner={owner}
						name={name}
						initialOverview={initialOverview}
					/>
					<RecentPrsPanel owner={owner} name={name} initialPrs={initialPrs} />
					<RecentIssuesPanel
						owner={owner}
						name={name}
						initialIssues={initialIssues}
					/>
				</div>
			</div>
		</SyncProgressOverlay>
	);
}

function PlaceholderDetail({
	icon,
	text,
}: {
	icon: React.ReactNode;
	text: string;
}) {
	return (
		<div className="flex h-full items-center justify-center">
			<div className="text-center">
				{icon}
				<p className="mt-3 text-sm text-muted-foreground">{text}</p>
			</div>
		</div>
	);
}

function NewIssueDetail({
	owner,
	name,
	repositoryId,
}: {
	owner: string;
	name: string;
	repositoryId: number | null;
}) {
	if (repositoryId === null) {
		return (
			<PlaceholderDetail
				icon={
					<CircleDot className="mx-auto size-10 text-muted-foreground/30" />
				}
				text="Repository not found"
			/>
		);
	}

	return (
		<NewIssueClient owner={owner} name={name} repositoryId={repositoryId} />
	);
}

function decodePath(path: string): string {
	return path
		.split("/")
		.map((segment) => {
			try {
				return decodeURIComponent(segment);
			} catch {
				return segment;
			}
		})
		.join("/");
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

function BlobDetail({
	owner,
	name,
	refName,
	path,
}: {
	owner: string;
	name: string;
	refName: string;
	path: string;
}) {
	const client = useCodeBrowse();
	const fileAtom = useMemo(
		() =>
			client.getFileContent.callAsQuery({
				ownerLogin: owner,
				name,
				ref: refName,
				path,
			}),
		[client, owner, name, refName, path],
	);
	const fileResult = useAtomValue(fileAtom);

	if (Result.isInitial(fileResult) || Result.isWaiting(fileResult)) {
		return (
			<div className="h-full p-4">
				<Skeleton className="h-full w-full" />
			</div>
		);
	}

	if (Result.isFailure(fileResult)) {
		return (
			<PlaceholderDetail
				icon={
					<FileCode2 className="mx-auto size-10 text-muted-foreground/30" />
				}
				text="Failed to load file"
			/>
		);
	}

	const fileOption = Result.value(fileResult);
	if (Option.isNone(fileOption) || fileOption.value === null) {
		return (
			<PlaceholderDetail
				icon={
					<FileCode2 className="mx-auto size-10 text-muted-foreground/30" />
				}
				text="File not found"
			/>
		);
	}

	if (fileOption.value.content === null) {
		return (
			<PlaceholderDetail
				icon={
					<FileCode2 className="mx-auto size-10 text-muted-foreground/30" />
				}
				text="Binary file - cannot display"
			/>
		);
	}

	return (
		<div className="h-full overflow-auto">
			<FileViewerMonaco
				path={fileOption.value.path}
				content={fileOption.value.content}
			/>
		</div>
	);
}

function RootRoute() {
	const { initialRepos, initialDashboard } = useLoaderData<RootLoaderData>();

	return (
		<MainSiteShellClient
			owner={null}
			name={null}
			initialRepos={initialRepos}
			sidebar={<SidebarRepoList initialRepos={initialRepos} />}
			detail={<DashboardDetail owner={null} initialData={initialDashboard} />}
		/>
	);
}

function OwnerRoute() {
	const { owner, initialRepos, initialDashboard } =
		useLoaderData<OwnerLoaderData>();

	return (
		<MainSiteShellClient
			owner={owner}
			name={null}
			initialRepos={initialRepos}
			sidebar={<SidebarRepoList initialRepos={initialRepos} />}
			detail={<DashboardDetail owner={owner} initialData={initialDashboard} />}
		/>
	);
}

function RepoOverviewRoute() {
	const {
		owner,
		name,
		initialRepos,
		initialOverview,
		initialPrs,
		initialIssues,
	} = useLoaderData<RepoOverviewLoaderData>();

	return (
		<MainSiteShellClient
			owner={owner}
			name={name}
			initialRepos={initialRepos}
			activeTab="pulls"
			sidebar={
				<RepoListShell
					paramsPromise={Promise.resolve({ owner, name })}
					activeTab="pulls"
				>
					<PrListClient owner={owner} name={name} initialData={initialPrs} />
				</RepoListShell>
			}
			detail={
				<RepoOverviewDetail
					owner={owner}
					name={name}
					initialOverview={initialOverview}
					initialPrs={initialPrs}
					initialIssues={initialIssues}
				/>
			}
		/>
	);
}

function PullsRoute() {
	const { owner, name, initialRepos, initialPrs } =
		useLoaderData<PullsLoaderData>();

	return (
		<MainSiteShellClient
			owner={owner}
			name={name}
			initialRepos={initialRepos}
			activeTab="pulls"
			sidebar={
				<RepoListShell
					paramsPromise={Promise.resolve({ owner, name })}
					activeTab="pulls"
				>
					<PrListClient owner={owner} name={name} initialData={initialPrs} />
				</RepoListShell>
			}
			detail={
				<SyncProgressOverlay owner={owner} name={name}>
					<PlaceholderDetail
						icon={
							<GitPullRequest className="mx-auto size-10 text-muted-foreground/30" />
						}
						text="Select a pull request to view details"
					/>
				</SyncProgressOverlay>
			}
		/>
	);
}

function PullDetailRoute() {
	const {
		owner,
		name,
		prNumber,
		initialRepos,
		initialPrs,
		initialPr,
		initialFiles,
	} = useLoaderData<PullDetailLoaderData>();

	return (
		<MainSiteShellClient
			owner={owner}
			name={name}
			initialRepos={initialRepos}
			activeTab="pulls"
			sidebar={
				<RepoListShell
					paramsPromise={Promise.resolve({ owner, name })}
					activeTab="pulls"
				>
					<PrListClient
						owner={owner}
						name={name}
						initialData={initialPrs}
						activePullNumber={prNumber}
					/>
				</RepoListShell>
			}
			detail={
				<PrDetailClient
					owner={owner}
					name={name}
					prNumber={prNumber}
					initialPr={initialPr}
					initialFiles={initialFiles}
				/>
			}
		/>
	);
}

function IssuesRoute() {
	const { owner, name, initialRepos, initialOverview, initialIssues } =
		useLoaderData<IssuesLoaderData>();
	const repositoryId = initialOverview?.repositoryId ?? null;

	return (
		<MainSiteShellClient
			owner={owner}
			name={name}
			initialRepos={initialRepos}
			activeTab="issues"
			sidebar={
				<RepoListShell
					paramsPromise={Promise.resolve({ owner, name })}
					activeTab="issues"
				>
					<IssueListClient
						owner={owner}
						name={name}
						repositoryId={repositoryId}
						initialData={initialIssues}
					/>
				</RepoListShell>
			}
			detail={
				<SyncProgressOverlay owner={owner} name={name}>
					<PlaceholderDetail
						icon={
							<CircleDot className="mx-auto size-10 text-muted-foreground/30" />
						}
						text="Select an issue to view details"
					/>
				</SyncProgressOverlay>
			}
		/>
	);
}

function IssueDetailRoute() {
	const {
		owner,
		name,
		issueNumber,
		initialRepos,
		initialOverview,
		initialIssues,
		initialIssue,
	} = useLoaderData<IssueDetailLoaderData>();
	const repositoryId = initialOverview?.repositoryId ?? null;

	return (
		<MainSiteShellClient
			owner={owner}
			name={name}
			initialRepos={initialRepos}
			activeTab="issues"
			sidebar={
				<RepoListShell
					paramsPromise={Promise.resolve({ owner, name })}
					activeTab="issues"
				>
					<IssueListClient
						owner={owner}
						name={name}
						repositoryId={repositoryId}
						initialData={initialIssues}
						activeIssueNumber={issueNumber}
					/>
				</RepoListShell>
			}
			detail={
				<IssueDetailClient
					owner={owner}
					name={name}
					issueNumber={issueNumber}
					initialIssue={initialIssue}
				/>
			}
		/>
	);
}

function NewIssueRoute() {
	const { owner, name, initialRepos, initialOverview, initialIssues } =
		useLoaderData<NewIssueLoaderData>();
	const repositoryId = initialOverview?.repositoryId ?? null;

	return (
		<MainSiteShellClient
			owner={owner}
			name={name}
			initialRepos={initialRepos}
			activeTab="issues"
			sidebar={
				<RepoListShell
					paramsPromise={Promise.resolve({ owner, name })}
					activeTab="issues"
				>
					<IssueListClient
						owner={owner}
						name={name}
						repositoryId={repositoryId}
						initialData={initialIssues}
					/>
				</RepoListShell>
			}
			detail={
				<NewIssueDetail owner={owner} name={name} repositoryId={repositoryId} />
			}
		/>
	);
}

function ActionsRoute() {
	const { owner, name, initialRepos, initialRuns } =
		useLoaderData<ActionsLoaderData>();

	return (
		<MainSiteShellClient
			owner={owner}
			name={name}
			initialRepos={initialRepos}
			activeTab="actions"
			sidebar={
				<RepoListShell
					paramsPromise={Promise.resolve({ owner, name })}
					activeTab="actions"
				>
					<WorkflowRunListClient
						owner={owner}
						name={name}
						initialData={initialRuns}
					/>
				</RepoListShell>
			}
			detail={
				<SyncProgressOverlay owner={owner} name={name}>
					<PlaceholderDetail
						icon={<Play className="mx-auto size-10 text-muted-foreground/30" />}
						text="Select a workflow run to view details"
					/>
				</SyncProgressOverlay>
			}
		/>
	);
}

function RunDetailRoute() {
	const { owner, name, runNumber, initialRepos, initialRuns, initialRun } =
		useLoaderData<RunDetailLoaderData>();

	return (
		<MainSiteShellClient
			owner={owner}
			name={name}
			initialRepos={initialRepos}
			activeTab="actions"
			sidebar={
				<RepoListShell
					paramsPromise={Promise.resolve({ owner, name })}
					activeTab="actions"
				>
					<WorkflowRunListClient
						owner={owner}
						name={name}
						initialData={initialRuns}
						activeRunNumber={runNumber}
					/>
				</RepoListShell>
			}
			detail={
				<WorkflowRunDetailClient
					owner={owner}
					name={name}
					runNumber={runNumber}
					initialRun={initialRun}
				/>
			}
		/>
	);
}

function TreeRoute() {
	const { owner, name, initialRepos } = useLoaderData<CodeLoaderData>();

	return (
		<MainSiteShellClient
			owner={owner}
			name={name}
			initialRepos={initialRepos}
			activeTab="code"
			sidebar={
				<RepoListShell
					paramsPromise={Promise.resolve({ owner, name })}
					activeTab="code"
				>
					<FileTreeClient owner={owner} name={name} />
				</RepoListShell>
			}
			detail={
				<PlaceholderDetail
					icon={
						<FileCode2 className="mx-auto size-10 text-muted-foreground/30" />
					}
					text="Select a file from the tree to view its contents"
				/>
			}
		/>
	);
}

function BlobRoute() {
	const { owner, name, ref, path, initialRepos } =
		useLoaderData<BlobLoaderData>();

	return (
		<MainSiteShellClient
			owner={owner}
			name={name}
			initialRepos={initialRepos}
			activeTab="code"
			sidebar={
				<RepoListShell
					paramsPromise={Promise.resolve({ owner, name })}
					activeTab="code"
				>
					<FileTreeClient owner={owner} name={name} />
				</RepoListShell>
			}
			detail={
				<BlobDetail owner={owner} name={name} refName={ref} path={path} />
			}
		/>
	);
}

function NotificationsRoute() {
	const { initialRepos, initialNotifications } =
		useLoaderData<NotificationsLoaderData>();

	return (
		<MainSiteShellClient
			owner={null}
			name={null}
			initialRepos={initialRepos}
			sidebar={<SidebarRepoList initialRepos={initialRepos} />}
			detail={
				<NotificationsClient initialNotifications={initialNotifications} />
			}
		/>
	);
}

function NavigationPendingOverlay() {
	const navigation = useNavigation();
	const [isVisible, setIsVisible] = useState(false);

	useEffect(() => {
		if (navigation.state === "idle") {
			setIsVisible(false);
			return;
		}

		const timeout = setTimeout(() => {
			setIsVisible(true);
		}, 120);

		return () => {
			clearTimeout(timeout);
		};
	}, [navigation.state]);

	if (!isVisible) {
		return null;
	}

	return (
		<div className="pointer-events-none fixed inset-0 z-50 bg-background/55">
			<div className="mx-auto flex h-full w-full max-w-[1600px] gap-3 px-3 py-3 md:px-4 md:py-4">
				<div className="hidden md:block w-[18%] min-w-[13rem] rounded-lg border border-border/70 bg-card/80 p-3">
					<div className="space-y-2">
						<Skeleton className="h-8 w-full" />
						<Skeleton className="h-7 w-full" />
						<Skeleton className="h-7 w-full" />
						<Skeleton className="h-7 w-full" />
						<Skeleton className="h-7 w-full" />
					</div>
				</div>
				<div className="min-w-0 flex-1 rounded-lg border border-border/70 bg-card/80 p-4">
					<div className="space-y-3">
						<Skeleton className="h-7 w-1/2" />
						<Skeleton className="h-4 w-1/3" />
						<Skeleton className="h-28 w-full" />
						<Skeleton className="h-28 w-full" />
						<Skeleton className="h-28 w-full" />
					</div>
				</div>
			</div>
		</div>
	);
}

function SpaRootRoute() {
	return (
		<>
			<SpaNavigationBridge />
			<Outlet />
			<NavigationPendingOverlay />
		</>
	);
}

const appRouter = createBrowserRouter([
	{
		path: "/",
		element: <SpaRootRoute />,
		children: [
			{
				index: true,
				loader: rootLoader,
				element: <RootRoute />,
			},
			{
				path: "notifications",
				loader: notificationsLoader,
				element: <NotificationsRoute />,
			},
			{
				path: ":owner/:name/pull/:number",
				loader: pullDetailLoader,
				element: <PullDetailRoute />,
			},
			{
				path: ":owner/:name/pulls",
				loader: pullsLoader,
				element: <PullsRoute />,
			},
			{
				path: ":owner/:name/issues/new",
				loader: newIssueLoader,
				element: <NewIssueRoute />,
			},
			{
				path: ":owner/:name/issues/:number",
				loader: issueDetailLoader,
				element: <IssueDetailRoute />,
			},
			{
				path: ":owner/:name/issues",
				loader: issuesLoader,
				element: <IssuesRoute />,
			},
			{
				path: ":owner/:name/actions/runs/:runId",
				loader: runDetailLoader,
				element: <RunDetailRoute />,
			},
			{
				path: ":owner/:name/actions",
				loader: actionsLoader,
				element: <ActionsRoute />,
			},
			{
				path: ":owner/:name/tree/:ref/*",
				loader: codeLoader,
				element: <TreeRoute />,
			},
			{
				path: ":owner/:name/tree/:ref",
				loader: codeLoader,
				element: <TreeRoute />,
			},
			{
				path: ":owner/:name/blob/:ref/*",
				loader: blobLoader,
				element: <BlobRoute />,
			},
			{
				path: ":owner/:name/activity",
				loader: repoOverviewLoader,
				element: <RepoOverviewRoute />,
			},
			{
				path: ":owner/:name",
				loader: repoOverviewLoader,
				element: <RepoOverviewRoute />,
			},
			{
				path: ":owner",
				loader: ownerLoader,
				element: <OwnerRoute />,
			},
			{
				path: "*",
				element: <Navigate to="/" replace />,
			},
		],
	},
]);

const PREFETCH_TTL_MS = 20_000;
const prefetchedRouteLoads = new Map<string, number>();

const prefetchHref = (href: string) => {
	if (typeof window === "undefined") {
		return;
	}

	const url = new URL(href, window.location.origin);
	if (url.origin !== window.location.origin) {
		return;
	}

	const target = `${url.pathname}${url.search}`;
	const routeMatches = matchRoutes(appRouter.routes, {
		pathname: url.pathname,
	});
	if (routeMatches === null) {
		return;
	}

	const now = Date.now();

	for (const match of routeMatches) {
		const route = match.route;
		if (route.id === undefined || route.loader === undefined) {
			continue;
		}

		const prefetchKey = `${target}:${route.id}`;
		const lastPrefetchedAt = prefetchedRouteLoads.get(prefetchKey);
		if (
			lastPrefetchedAt !== undefined &&
			now - lastPrefetchedAt < PREFETCH_TTL_MS
		) {
			continue;
		}

		prefetchedRouteLoads.set(prefetchKey, now);
		void appRouter.fetch(`prefetch:${prefetchKey}`, route.id, target);
	}
};

function SpaNavigationBridge() {
	const navigate = useNavigate();
	const location = useLocation();
	const locationKey = `${location.pathname}${location.search}${location.hash}`;

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const onPrefetch: EventListener = (event) => {
			if (!("detail" in event)) {
				return;
			}

			const detail = event.detail;
			if (typeof detail !== "object" || detail === null) {
				return;
			}

			const href = Reflect.get(detail, "href");
			if (typeof href !== "string") {
				return;
			}

			prefetchHref(href);
		};

		const onNavigate: EventListener = (event) => {
			if (!("detail" in event)) {
				return;
			}

			const detail = event.detail;
			if (typeof detail !== "object" || detail === null) {
				return;
			}

			const href = Reflect.get(detail, "href");
			if (typeof href !== "string") {
				return;
			}

			navigate(href);
		};

		window.addEventListener(quickHubPrefetchEvent, onPrefetch);
		window.addEventListener(quickHubNavigateEvent, onNavigate);
		return () => {
			window.removeEventListener(quickHubPrefetchEvent, onPrefetch);
			window.removeEventListener(quickHubNavigateEvent, onNavigate);
		};
	}, [navigate]);

	useEffect(() => {
		void locationKey;
		notifyQuickHubNavigation();
	}, [locationKey]);

	return null;
}

export default function App() {
	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		Reflect.set(window, "__quickhubSpa", true);
		return () => {
			Reflect.set(window, "__quickhubSpa", false);
		};
	}, []);

	return <RouterProvider router={appRouter} />;
}
