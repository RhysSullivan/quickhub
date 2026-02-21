"use client";

import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import { Input } from "@packages/ui/components/input";
import { Link } from "@packages/ui/components/link";
import { useInfinitePaginationWithInitial } from "@packages/ui/hooks/use-paginated-atom";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Loader2, MessageCircle, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

/** Scroll the PR list item with the given number into view within its scroll container */
function scrollPrIntoView(prNumber: number) {
	requestAnimationFrame(() => {
		const el = document.querySelector(`[data-pr-number="${prNumber}"]`);
		el?.scrollIntoView({ block: "nearest" });
	});
}

const PAGE_SIZE = 30;

type PrItem = {
	readonly number: number;
	readonly state: "open" | "closed";
	readonly optimisticState: "pending" | "failed" | "confirmed" | null;
	readonly optimisticErrorMessage: string | null;
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
	const [titleFilter, setTitleFilter] = useState("");
	const filterInputId = useId();

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

	const pagination = useInfinitePaginationWithInitial(
		paginatedAtom,
		initialData,
	);
	const { items: prs, sentinelRef, isLoading } = pagination;

	const normalizedFilter = titleFilter.trim().toLowerCase();
	const filteredPrs = useMemo(
		() =>
			prs.filter((pr) => {
				if (normalizedFilter.length === 0) return true;
				return (
					pr.title.toLowerCase().includes(normalizedFilter) ||
					String(pr.number).includes(normalizedFilter) ||
					(pr.authorLogin?.toLowerCase().includes(normalizedFilter) ?? false)
				);
			}),
		[prs, normalizedFilter],
	);

	const pathname = usePathname();
	const router = useRouter();
	const activeNumber = (() => {
		const match = /\/pulls\/(\d+)/.exec(pathname);
		return match?.[1] ? Number.parseInt(match[1], 10) : null;
	})();

	// Find the index of the currently active PR for j/k navigation
	const activeIndex = filteredPrs.findIndex((pr) => pr.number === activeNumber);

	// When we load more pages via j at the end, navigate to the first new item
	const pendingNavRef = useRef<"next" | null>(null);
	const prevCountRef = useRef(filteredPrs.length);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== "/") return;

			const target = event.target;
			if (target instanceof HTMLElement) {
				const tag = target.tagName.toLowerCase();
				if (
					tag === "input" ||
					tag === "textarea" ||
					target.getAttribute("contenteditable") === "true"
				) {
					return;
				}
			}

			event.preventDefault();
			const input = document.getElementById(filterInputId);
			if (input instanceof HTMLInputElement) {
				input.focus();
				input.select();
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [filterInputId]);

	useEffect(() => {
		if (
			filteredPrs.length > prevCountRef.current &&
			pendingNavRef.current === "next"
		) {
			const nextIndex = prevCountRef.current; // first item of the new page
			const pr = filteredPrs[nextIndex];
			if (pr) {
				router.push(`/${owner}/${name}/pulls/${pr.number}`);
				scrollPrIntoView(pr.number);
			}
			pendingNavRef.current = null;
		}
		prevCountRef.current = filteredPrs.length;
	}, [filteredPrs.length, filteredPrs, owner, name, router]);

	const navigateTo = useCallback(
		(index: number) => {
			const pr = filteredPrs[index];
			if (pr) {
				router.push(`/${owner}/${name}/pulls/${pr.number}`);
				scrollPrIntoView(pr.number);
			}
		},
		[filteredPrs, owner, name, router],
	);

	// j — open next PR (matches GitHub issue/PR list navigation)
	useHotkey("J", (e) => {
		e.preventDefault();
		if (filteredPrs.length === 0) return;

		if (activeIndex === -1) {
			navigateTo(0);
			return;
		}

		const nextIndex = activeIndex + 1;
		if (nextIndex < filteredPrs.length) {
			navigateTo(nextIndex);
		} else if (pagination.hasMore && normalizedFilter.length === 0) {
			// At the end of loaded items — load more, then navigate once loaded
			pendingNavRef.current = "next";
			pagination.loadMore();
		}
	});

	// k — open previous PR (matches GitHub issue/PR list navigation)
	useHotkey("K", (e) => {
		e.preventDefault();
		if (filteredPrs.length === 0) return;
		const nextIndex = activeIndex === -1 ? 0 : Math.max(activeIndex - 1, 0);
		navigateTo(nextIndex);
	});

	// o — also open (for when no PR is active yet, opens the first one)
	useHotkey("O", (e) => {
		e.preventDefault();
		if (filteredPrs.length === 0) return;
		const index = activeIndex === -1 ? 0 : activeIndex;
		navigateTo(index);
	});

	return (
		<div className="p-1.5">
			<div className="mb-1.5 px-1">
				<div className="relative">
					<Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
					<Input
						id={filterInputId}
						value={titleFilter}
						onChange={(event) => setTitleFilter(event.target.value)}
						placeholder="Filter PRs by title, number, author (/ to focus)"
						className="h-7 pl-7 text-[11px]"
					/>
				</div>
			</div>
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

			{filteredPrs.length === 0 && !isLoading && (
				<p className="px-2 py-8 text-xs text-muted-foreground text-center">
					{normalizedFilter.length > 0
						? "No pull requests match this filter."
						: `No ${stateFilter !== "all" ? stateFilter : ""} pull requests.`}
				</p>
			)}

			{filteredPrs.map((pr) => (
				<Link
					key={pr.number}
					data-pr-number={pr.number}
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
							{pr.optimisticState === "pending" && (
								<Badge variant="outline" className="h-4 px-1 text-[9px]">
									Saving...
								</Badge>
							)}
							{pr.optimisticState === "failed" && (
								<Badge variant="destructive" className="h-4 px-1 text-[9px]">
									Write failed
								</Badge>
							)}
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
						{pr.optimisticState === "failed" &&
							pr.optimisticErrorMessage !== null && (
								<p className="mt-1 text-[10px] text-destructive truncate">
									{pr.optimisticErrorMessage}
								</p>
							)}
					</div>
					{pr.lastCheckConclusion && (
						<CheckDot conclusion={pr.lastCheckConclusion} />
					)}
				</Link>
			))}

			{/* Sentinel for infinite scroll */}
			<div ref={sentinelRef} className="h-1" />
			{isLoading && normalizedFilter.length === 0 && (
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
