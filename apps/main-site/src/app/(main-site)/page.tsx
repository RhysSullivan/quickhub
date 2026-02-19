"use client";

import { Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@packages/ui/components/card";
import { Input } from "@packages/ui/components/input";
import { Link } from "@packages/ui/components/link";
import { Skeleton } from "@packages/ui/components/skeleton";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useRepoOnboard } from "@packages/ui/rpc/repo-onboard";
import { Option } from "effect";
import { useMemo, useRef } from "react";

const EmptyPayload: Record<string, never> = {};

export default function HomePage() {
	const client = useProjectionQueries();
	const reposAtom = useMemo(
		() => client.listRepos.subscription(EmptyPayload),
		[client],
	);
	const reposResult = useAtomValue(reposAtom);

	return (
		<main className="mx-auto max-w-4xl px-3 py-6 sm:px-4 sm:py-12">
			<div className="mb-6 sm:mb-8">
				<h1 className="text-2xl sm:text-3xl font-bold">QuickHub</h1>
				<p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-muted-foreground">
					GitHub Mirror — Fast reads from Convex
				</p>
			</div>

			<AddRepoForm />

			{Result.isInitial(reposResult) && <RepoListSkeleton />}

			{Result.isFailure(reposResult) && (
				<p className="text-destructive">
					Failed to load repositories.
					<br />
					<code className="text-xs">
						{JSON.stringify(Option.getOrNull(Result.error(reposResult)))}
					</code>
				</p>
			)}

			{(() => {
				const valueOption = Result.value(reposResult);
				if (Option.isNone(valueOption)) return null;
				const repos = valueOption.value;

				if (repos.length === 0) {
					return (
						<Card className="mt-4">
							<CardHeader>
								<CardTitle>No repositories connected</CardTitle>
								<CardDescription>
									Enter a GitHub repository URL above to get started.
								</CardDescription>
							</CardHeader>
						</Card>
					);
				}

				return (
					<div className="mt-4 grid gap-3 sm:gap-4">
						{repos.map((repo) => (
							<Link
								key={repo.repositoryId}
								href={`/${repo.ownerLogin}/${repo.name}`}
								className="block no-underline"
							>
								<Card className="transition-colors hover:border-foreground/20">
									<CardHeader className="px-3 py-3 sm:px-6 sm:py-4">
										<div>
											<CardTitle className="text-base sm:text-lg break-words">
												{repo.fullName}
											</CardTitle>
											<CardDescription className="mt-1 text-xs sm:text-sm">
												{repo.lastPushAt
													? `Last push ${formatRelative(repo.lastPushAt)}`
													: "No pushes yet"}
											</CardDescription>
										</div>
										<div className="mt-2 sm:mt-3 flex flex-wrap gap-1.5 sm:gap-3">
											<Badge variant="secondary" className="text-xs">
												{repo.openPrCount} open PR
												{repo.openPrCount !== 1 ? "s" : ""}
											</Badge>
											<Badge variant="secondary" className="text-xs">
												{repo.openIssueCount} open issue
												{repo.openIssueCount !== 1 ? "s" : ""}
											</Badge>
											{repo.failingCheckCount > 0 && (
												<Badge variant="destructive" className="text-xs">
													{repo.failingCheckCount} failing check
													{repo.failingCheckCount !== 1 ? "s" : ""}
												</Badge>
											)}
										</div>
									</CardHeader>
								</Card>
							</Link>
						))}
					</div>
				);
			})()}
		</main>
	);
}

// ---------------------------------------------------------------------------
// Add Repo Form
// ---------------------------------------------------------------------------

function AddRepoForm() {
	const onboardClient = useRepoOnboard();
	const [addResult, addRepo] = useAtom(onboardClient.addRepoByUrl.call);
	const inputRef = useRef<HTMLInputElement>(null);

	const isLoading = Result.isWaiting(addResult);

	const errorMessage = (() => {
		if (!Result.isFailure(addResult)) return null;
		const errOpt = Result.error(addResult);
		if (Option.isNone(errOpt)) return "Unknown error";
		const err = errOpt.value;
		if (typeof err === "object" && err !== null && "_tag" in err) {
			const tagged = err as {
				_tag: string;
				fullName?: string;
				input?: string;
				reason?: string;
				message?: string;
				defect?: unknown;
			};
			switch (tagged._tag) {
				case "InvalidRepoUrl":
					return `Invalid URL: ${tagged.reason ?? "Could not parse"}`;
				case "RepoNotFound":
					return `Repository "${tagged.fullName}" not found on GitHub`;
				case "AlreadyConnected":
					return `Repository "${tagged.fullName}" is already connected`;
				case "WebhookSetupFailed":
					return `Webhook setup failed for "${tagged.fullName}": ${tagged.reason}`;
				case "RpcDefectError":
					return tagged.message ?? `Unexpected error: ${String(tagged.defect)}`;
				default:
					return `Error: ${tagged._tag}`;
			}
		}
		return String(err);
	})();

	const successMessage = (() => {
		if (!Result.isSuccess(addResult)) return null;
		const valOpt = Result.value(addResult);
		if (Option.isNone(valOpt)) return null;
		const val = valOpt.value;
		if (typeof val === "object" && val !== null && "fullName" in val) {
			const result = val as {
				fullName: string;
				webhookCreated: boolean;
				bootstrapScheduled: boolean;
			};
			const parts = [];
			if (result.webhookCreated) parts.push("webhook created");
			if (result.bootstrapScheduled) parts.push("syncing data...");
			return `Added ${result.fullName}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
		}
		return null;
	})();

	return (
		<div className="mb-4 sm:mb-6">
			<form
				className="flex flex-col sm:flex-row gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					const url = inputRef.current?.value.trim();
					if (!url || isLoading) return;
					addRepo({ url });
				}}
			>
				<Input
					ref={inputRef}
					placeholder="github.com/owner/repo or owner/repo"
					disabled={isLoading}
					className="flex-1"
				/>
				<Button type="submit" disabled={isLoading} className="sm:w-auto w-full">
					{isLoading ? "Syncing..." : "Add Repo"}
				</Button>
			</form>

			{errorMessage && (
				<p className="mt-2 text-sm text-destructive">{errorMessage}</p>
			)}

			{successMessage && (
				<p className="mt-2 text-sm text-green-600 dark:text-green-400">
					{successMessage}
				</p>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Skeletons & helpers
// ---------------------------------------------------------------------------

function RepoListSkeleton() {
	return (
		<div className="mt-4 grid gap-4">
			{[1, 2, 3].map((i) => (
				<Card key={i}>
					<CardHeader>
						<Skeleton className="h-5 w-48" />
						<Skeleton className="mt-2 h-4 w-32" />
						<div className="mt-3 flex gap-3">
							<Skeleton className="h-5 w-20" />
							<Skeleton className="h-5 w-24" />
						</div>
					</CardHeader>
				</Card>
			))}
		</div>
	);
}

function formatRelative(timestamp: number): string {
	const diff = Math.floor((Date.now() - timestamp) / 1000);
	if (diff < 60) return "just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
	return new Date(timestamp).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
