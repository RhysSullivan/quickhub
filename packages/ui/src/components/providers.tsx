"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";
import { ConvexClientProvider } from "./convex-client-provider";
import { HydrationProvider } from "./hydration-context";

export function Providers({ children }: { children: React.ReactNode }) {
	return (
		<HydrationProvider>
			<NextThemesProvider
				attribute="class"
				defaultTheme="system"
				enableSystem
				enableColorScheme
			>
				<ConvexClientProvider>{children}</ConvexClientProvider>
			</NextThemesProvider>
		</HydrationProvider>
	);
}
