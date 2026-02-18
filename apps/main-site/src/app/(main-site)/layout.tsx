import { Providers } from "@packages/ui/components/providers";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Create Epoch App",
	description: "Effect + Convex + Next.js starter template",
};

export default function MainSiteLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return <Providers>{children}</Providers>;
}
