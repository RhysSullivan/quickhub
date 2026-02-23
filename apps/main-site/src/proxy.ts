import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
	if (request.nextUrl.pathname.startsWith("/_internal/")) {
		const rewritten = request.nextUrl.clone();
		rewritten.pathname = request.nextUrl.pathname.replace(
			"/_internal/",
			"/internal/",
		);
		return NextResponse.rewrite(rewritten);
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)"],
};
