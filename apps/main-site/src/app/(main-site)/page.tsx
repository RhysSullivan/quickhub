"use client";

import { Result, useAtomValue } from "@effect-atom/atom-react";
import { Badge } from "@packages/ui/components/badge";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@packages/ui/components/card";
import { Link } from "@packages/ui/components/link";
import { Skeleton } from "@packages/ui/components/skeleton";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { Option } from "effect";
import { useMemo } from "react";

const EmptyPayload: Record<string, never> = {};

export default function HomePage() {
	const client = useProjectionQueries();
	const reposAtom = useMemo(
		() => client.listRepos.subscription(EmptyPayload),
		[client],
	);
	const reposResult = useAtomValue(reposAtom);

	return (
		<main className="mx-auto max-w-4xl px-4 py-12">
			<div className="mb-8">
				<h1 className="text-3xl font-bold">QuickHub</h1>
				<p className="mt-2 text-muted-foreground">
					GitHub Mirror — Fast reads from Convex
				</p>
			</div>

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
						<Card>
							<CardHeader>
								<CardTitle>No repositories connected</CardTitle>
								<CardDescription>
									Connect a GitHub repository using the{" "}
									<code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
										connectRepo
									</code>{" "}
									mutation to get started.
								</CardDescription>
							</CardHeader>
						</Card>
					);
				}

				return (
					<div className="grid gap-4">
						{repos.map((repo) => (
							<Link
								key={repo.repositoryId}
								href={`/${repo.ownerLogin}/${repo.name}`}
								className="block no-underline"
							>
								<Card className="transition-colors hover:border-foreground/20">
									<CardHeader>
										<div className="flex items-start justify-between">
											<div>
												<CardTitle className="text-lg">
													{repo.fullName}
												</CardTitle>
												<CardDescription className="mt-1">
													{repo.lastPushAt
														? `Last push ${formatRelative(repo.lastPushAt)}`
														: "No pushes yet"}
												</CardDescription>
											</div>
										</div>
										<div className="mt-3 flex gap-3">
											<Badge variant="secondary">
												{repo.openPrCount} open PR
												{repo.openPrCount !== 1 ? "s" : ""}
											</Badge>
											<Badge variant="secondary">
												{repo.openIssueCount} open issue
												{repo.openIssueCount !== 1 ? "s" : ""}
											</Badge>
											{repo.failingCheckCount > 0 && (
												<Badge variant="destructive">
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

function RepoListSkeleton() {
	return (
		<div className="grid gap-4">
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
