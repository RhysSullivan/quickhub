import { Providers } from "@packages/ui/components/providers";
import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { HubShell } from "./_components/hub-shell";
import { MainSiteSidebar } from "./_components/main-site-sidebar";
import { SidebarSkeleton } from "./_components/sidebar-client";

export const metadata: Metadata = {
	title: "FasterGH — GitHub Mirror",
	description: "Fast GitHub browsing backed by Convex real-time projections",
};

function DetailShellFallback() {
	return <div className="h-full animate-pulse bg-background" />;
}

/**
 * Root layout for the main site.
 *
 * The sidebar is a fully client-side component — it reads the URL
 * client-side and renders the appropriate content. No parallel routes,
 * no server-side Suspense. Navigations never cause the sidebar to flash.
 *
 * `children` maps to `page.tsx` files and renders the main detail content.
 */
export default function MainSiteLayout({ children }: { children: ReactNode }) {
	return (
		<Providers>
			<HubShell
				sidebar={
					<Suspense fallback={<SidebarSkeleton />}>
						<MainSiteSidebar />
					</Suspense>
				}
				detail={
					<Suspense fallback={<DetailShellFallback />}>{children}</Suspense>
				}
			/>
		</Providers>
	);
}
