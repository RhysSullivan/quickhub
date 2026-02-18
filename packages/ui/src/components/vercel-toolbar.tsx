"use client";

import { VercelToolbar as VT } from "@vercel/toolbar/next";

export function VercelToolbar() {
	const isDev = process.env.NODE_ENV === "development";

	if (!isDev) {
		return null;
	}

	return <VT />;
}
