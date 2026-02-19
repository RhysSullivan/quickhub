import "@packages/ui/globals.css";
import { SpeculationRules } from "@packages/ui/components/speculation-rules";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

const isProduction = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === "production";

export const metadata: Metadata = {
	robots: {
		index: isProduction,
		follow: isProduction,
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<SpeculationRules />
			</head>
			<body>
				<NuqsAdapter>{children}</NuqsAdapter>
				<SpeedInsights sampleRate={0.1} />
			</body>
		</html>
	);
}
