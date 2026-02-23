import { NextResponse } from "next/server";
import { resolveSetupRedirectPath } from "./redirect-state";

/**
 * GitHub App installation callback endpoint.
 *
 * GitHub redirects users here after install/update with query params.
 * We validate basic presence and then redirect to the dashboard while
 * webhook processing fills data in the background.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const installationId = url.searchParams.get("installation_id");
	const setupAction = url.searchParams.get("setup_action");
	const redirectPath = resolveSetupRedirectPath(url.searchParams.get("state"), url);

	if (!installationId || !setupAction) {
		return NextResponse.redirect(new URL("/", request.url));
	}

	return NextResponse.redirect(new URL(redirectPath, request.url));
}
