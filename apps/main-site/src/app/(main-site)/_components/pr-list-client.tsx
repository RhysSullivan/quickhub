"use client";

import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import { Link } from "@packages/ui/components/link";
import { useInfinitePaginationWithInitial } from "@packages/ui/hooks/use-paginated-atom";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Loader2, MessageCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const PAGE_SIZE = 30;

type PrItem = {
	readonly number: number;
	readonly state: "open" | "closed";
	readonly draft: boolean;
	readonly title: string;
	readonly authorLogin: string | null;
	readonly authorAvatarUrl: string | null;
	readonly headRefName: string;
	readonly baseRefName: string;
	readonly commentCount: number;
	readonly reviewCount: number;
	readonly lastCheckConclusion: string | null;
	readonly githubUpdatedAt: number;
};

export function PrListClient({
	owner,
	name,
	initialData = [],
}: {
	owner: string;
	name: string;
	initialData?: ReadonlyArray<PrItem>;
}) {
	const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">(
		"open",
	);

	const client = useProjectionQueries();
	const paginatedAtom = useMemo(
		() =>
			client.listPullRequestsPaginated.paginated(PAGE_SIZE, {
				ownerLogin: owner,
				name,
				state: stateFilter === "all" ? undefined : stateFilter,
			}),
		[client, owner, name, stateFilter],
	);

	const {
		items: prs,
		sentinelRef,
		isLoading,
	} = useInfinitePaginationWithInitial(paginatedAtom, initialData);

	const pathname = usePathname();
	const router = useRouter();
	const activeNumber = (() => {
		const match = /\/pulls\/(\d+)/.exec(pathname);
		return match?.[1] ? Number.parseInt(match[1], 10) : null;
	})();

	// Find the index of the currently active PR for j/k navigation
	const activeIndex = prs.findIndex((pr) => pr.number === activeNumber);

	// j — open next PR (matches GitHub issue/PR list navigation)
	useHotkey("J", (e) => {
		e.preventDefault();
		if (prs.length === 0) return;
		const nextIndex =
			activeIndex === -1 ? 0 : Math.min(activeIndex + 1, prs.length - 1);
		const pr = prs[nextIndex];
		if (pr) {
			router.push(`/${owner}/${name}/pulls/${pr.number}`);
		}
	});

	// k — open previous PR (matches GitHub issue/PR list navigation)
	useHotkey("K", (e) => {
		e.preventDefault();
		if (prs.length === 0) return;
		const nextIndex = activeIndex === -1 ? 0 : Math.max(activeIndex - 1, 0);
		const pr = prs[nextIndex];
		if (pr) {
			router.push(`/${owner}/${name}/pulls/${pr.number}`);
		}
	});

	// o — also open (for when no PR is active yet, opens the first one)
	useHotkey("O", (e) => {
		e.preventDefault();
		if (prs.length === 0) return;
		const index = activeIndex === -1 ? 0 : activeIndex;
		const pr = prs[index];
		if (pr) {
			router.push(`/${owner}/${name}/pulls/${pr.number}`);
		}
	});

	return (
		<div className="p-1.5">
			<div className="flex gap-0.5 mb-1.5 px-1">
				{(["open", "closed", "all"] as const).map((f) => (
					<Button
						key={f}
						variant={stateFilter === f ? "default" : "ghost"}
						size="sm"
						className="h-6 text-[10px] px-2 font-medium"
						onClick={() => setStateFilter(f)}
					>
						{f === "open" ? "Open" : f === "closed" ? "Closed" : "All"}
					</Button>
				))}
			</div>

			{prs.length === 0 && !isLoading && (
				<p className="px-2 py-8 text-xs text-muted-foreground text-center">
					No {stateFilter !== "all" ? stateFilter : ""} pull requests.
				</p>
			)}

			{prs.map((pr) => (
				<Link
					key={pr.number}
					href={`/${owner}/${name}/pulls/${pr.number}`}
					className={cn(
						"flex items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors no-underline",
						activeNumber === pr.number
							? "bg-accent text-accent-foreground"
							: "hover:bg-accent/50",
					)}
				>
					<PrStateIcon state={pr.state} draft={pr.draft} />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							<span className="font-medium text-xs truncate leading-tight">
								{pr.title}
							</span>
							{pr.draft && (
								<Badge
									variant="outline"
									className="text-[9px] px-1 py-0 shrink-0"
								>
									Draft
								</Badge>
							)}
						</div>
						<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5 tabular-nums">
							<span>#{pr.number}</span>
							{pr.authorLogin && (
								<>
									<span className="text-muted-foreground/40">&middot;</span>
									<span>{pr.authorLogin}</span>
								</>
							)}
							<span className="text-muted-foreground/40">&middot;</span>
							<span>{formatRelative(pr.githubUpdatedAt)}</span>
							{pr.commentCount > 0 && (
								<span className="flex items-center gap-0.5">
									<MessageCircle className="size-2.5" />
									{pr.commentCount}
								</span>
							)}
						</div>
					</div>
					{pr.lastCheckConclusion && (
						<CheckDot conclusion={pr.lastCheckConclusion} />
					)}
				</Link>
			))}

			{/* Sentinel for infinite scroll */}
			<div ref={sentinelRef} className="h-1" />
			{isLoading && (
				<div className="flex items-center justify-center py-3">
					<Loader2 className="size-4 animate-spin text-muted-foreground" />
				</div>
			)}
		</div>
	);
}

// --- Small helpers inlined to avoid imports ---

function PrStateIcon({
	state,
	draft,
}: {
	state: "open" | "closed";
	draft: boolean;
}) {
	if (draft)
		return (
			<div className="mt-0.5 size-3.5 rounded-full border-2 border-muted-foreground" />
		);
	if (state === "open")
		return (
			<svg
				className="mt-0.5 size-3.5 text-green-600"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
			</svg>
		);
	return (
		<svg
			className="mt-0.5 size-3.5 text-purple-600"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8-9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
		</svg>
	);
}

function CheckDot({ conclusion }: { conclusion: string }) {
	if (conclusion === "success")
		return <div className="size-2 rounded-full bg-green-500 shrink-0" />;
	if (conclusion === "failure")
		return <div className="size-2 rounded-full bg-red-500 shrink-0" />;
	return <div className="size-2 rounded-full bg-yellow-500 shrink-0" />;
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
