import { type NextRequest, NextResponse } from "next/server";

const OTEL_PROXY_TARGET =
	process.env.OTEL_COLLECTOR_PROXY_TARGET ?? "http://127.0.0.1:4318/v1/traces";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
	const contentType = request.headers.get("content-type") ?? "application/json";
	const body = await request.text();

	const response = await fetch(OTEL_PROXY_TARGET, {
		method: "POST",
		headers: {
			"content-type": contentType,
		},
		body,
		cache: "no-store",
	});

	const responseBody = await response.text();
	const responseContentType =
		response.headers.get("content-type") ?? "application/json";

	return new NextResponse(responseBody, {
		status: response.status,
		headers: {
			"content-type": responseContentType,
		},
	});
}
