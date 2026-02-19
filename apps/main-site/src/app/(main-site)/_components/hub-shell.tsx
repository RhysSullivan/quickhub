"use client";

import { KeyboardShortcutsDialog } from "@packages/ui/components/keyboard-shortcuts-dialog";
import { Link } from "@packages/ui/components/link";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@packages/ui/components/resizable";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";

/**
 * Two-panel resizable shell that positions parallel route slots.
 * Desktop always shows both panels side-by-side.
 * Mobile shows one panel at a time based on URL depth.
 *
 * The left panel shows either the repo sidebar (at /) or the list view
 * (at /owner/name/pulls|issues|actions) — swapped by Next.js parallel routes.
 *
 * The dynamic `usePathname()` call is isolated inside `<MobileView>` and
 * wrapped in `<Suspense>` so the rest of the shell can be prerendered.
 */
export function HubShell({
	sidebar,
	detail,
}: {
	sidebar: ReactNode;
	detail: ReactNode;
}) {
	return (
		<div className="h-dvh w-full bg-background">
			{/* Desktop: two-panel resizable */}
			<div className="hidden md:block h-full">
				<ResizablePanelGroup direction="horizontal" className="h-full">
					{/* Panel 1: Sidebar (repos or list) */}
					<ResizablePanel
						defaultSize={25}
						minSize={16}
						maxSize={40}
						className="border-r border-border/60"
					>
						<Suspense fallback={null}>{sidebar}</Suspense>
					</ResizablePanel>

					<ResizableHandle />

					{/* Panel 2: Detail/Content */}
					<ResizablePanel defaultSize={75} minSize={40} className="min-w-0">
						<Suspense fallback={null}>{detail}</Suspense>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>

			{/* Mobile: stacked view — usePathname is isolated here */}
			<div className="md:hidden h-full">
				<Suspense>
					<MobileView sidebar={sidebar} detail={detail} />
				</Suspense>
			</div>

			<KeyboardShortcutsDialog />
		</div>
	);
}

/**
 * Mobile panel switcher — the only component that calls `usePathname()`.
 * Isolated inside Suspense so it doesn't block prerendering.
 */
function MobileView({
	sidebar,
	detail,
}: {
	sidebar: ReactNode;
	detail: ReactNode;
}) {
	const pathname = usePathname();
	const segments = pathname.split("/").filter(Boolean);

	const owner = segments.length >= 2 ? segments[0] : null;
	const name = segments.length >= 2 ? segments[1] : null;
	const tabSegment = segments[2];
	const tab =
		tabSegment === "issues"
			? "issues"
			: tabSegment === "actions"
				? "actions"
				: "pulls";
	const hasDetail = segments.length >= 4;

	// Detail view: show detail with back-to-list link
	if (owner && name && hasDetail) {
		return (
			<div className="flex h-full flex-col">
				<div className="shrink-0 flex items-center gap-2 border-b px-3 py-2">
					<Link
						href={`/${owner}/${name}/${tab}`}
						className="text-[11px] text-muted-foreground hover:text-foreground no-underline flex items-center gap-1 font-medium"
					>
						<ArrowLeft className="size-3" />
						Back to list
					</Link>
				</div>
				<div className="flex-1 overflow-y-auto">{detail}</div>
			</div>
		);
	}

	// Repo selected or root: show the sidebar (which contains repo list OR item list)
	return sidebar;
}
