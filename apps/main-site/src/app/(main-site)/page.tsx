import { cacheLife } from "next/cache";
import type { ReactNode } from "react";
import {
	CommandPaletteClient,
	IssuesColumnClient,
	PrColumnClient,
	ReposColumnClient,
	SignInCta,
} from "./_components/home-dashboard-client";

/**
 * Home dashboard page.
 *
 * Entry component creates dynamic slots; cached shell renders the layout.
 */
export default function HomePage() {
	return (
		<DashboardShell
			commandPalette={<CommandPaletteClient query={{}} />}
			prColumn={<PrColumnClient query={{}} />}
			issuesColumn={<IssuesColumnClient query={{}} />}
			reposColumn={<ReposColumnClient query={{}} />}
		/>
	);
}

/** Cached static shell — deterministic layout, no request-specific data. */
async function DashboardShell({
	commandPalette,
	prColumn,
	issuesColumn,
	reposColumn,
}: {
	commandPalette: ReactNode;
	prColumn: ReactNode;
	issuesColumn: ReactNode;
	reposColumn: ReactNode;
}) {
	"use cache";
	cacheLife("max");

	return (
		<div className="h-full overflow-y-auto bg-dotgrid">
			<div className="mx-auto max-w-400 px-4 py-4 md:px-6 md:py-5">
				{/* Command palette */}
				<div className="mb-4">{commandPalette}</div>

				{/* Sign-in CTA — renders nothing if signed in */}
				<SignInCta />

				{/* Three-column grid */}
				<div className="grid gap-4 lg:grid-cols-3">
					<div key="pr">{prColumn}</div>
					<div key="issues">{issuesColumn}</div>
					<div key="repos">{reposColumn}</div>
				</div>
			</div>
		</div>
	);
}
