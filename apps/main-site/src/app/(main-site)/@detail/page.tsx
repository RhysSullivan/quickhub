import { GitPullRequest } from "lucide-react";

/**
 * Root page for the @detail slot — shows an empty state at "/".
 * This must exist as a page.tsx (not just default.tsx) so that navigating
 * back to "/" from a nested route properly resolves the parallel route
 * instead of showing a stale detail panel.
 */
export default function DetailSlot() {
	return (
		<div className="flex h-full items-center justify-center">
			<div className="text-center">
				<div className="mx-auto size-12 rounded-full bg-muted/40 flex items-center justify-center">
					<GitPullRequest className="size-5 text-muted-foreground/30" />
				</div>
				<p className="mt-3 text-xs font-medium text-muted-foreground">
					Select an item to view details
				</p>
			</div>
		</div>
	);
}
