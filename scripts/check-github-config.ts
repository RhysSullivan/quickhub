#!/usr/bin/env bun

/**
 * Verify GitHub App configuration for QuickHub.
 *
 * Checks:
 * 1. Required Convex environment variables are set
 * 2. Required .env / Next.js environment variables are set
 * 3. GitHub App exists and is reachable via `gh` CLI
 * 4. Webhook secret matches between .env and Convex
 * 5. GitHub App private key format is valid (if set)
 *
 * Usage:
 *   bun scripts/check-github-config.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const ROOT = join(import.meta.dir, "..");
const DATABASE_DIR = join(ROOT, "packages/database");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pass = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = (msg: string) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
const warn = (msg: string) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);
const info = (msg: string) => console.log(`  \x1b[36m·\x1b[0m ${msg}`);
const heading = (msg: string) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

let failures = 0;
let warnings = 0;

const check = (ok: boolean, passMsg: string, failMsg: string) => {
	if (ok) {
		pass(passMsg);
	} else {
		fail(failMsg);
		failures++;
	}
	return ok;
};

const softCheck = (ok: boolean, passMsg: string, warnMsg: string) => {
	if (ok) {
		pass(passMsg);
	} else {
		warn(warnMsg);
		warnings++;
	}
	return ok;
};

// ---------------------------------------------------------------------------
// 1. Parse .env file
// ---------------------------------------------------------------------------

const parseEnvFile = (path: string): Map<string, string> => {
	const vars = new Map<string, string>();
	if (!existsSync(path)) return vars;
	const content = readFileSync(path, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		let value = trimmed.slice(eqIdx + 1).trim();
		// Strip surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		vars.set(key, value);
	}
	return vars;
};

// ---------------------------------------------------------------------------
// 2. Fetch Convex env vars
// ---------------------------------------------------------------------------

const getConvexEnvVars = async (): Promise<Map<string, string>> => {
	const vars = new Map<string, string>();
	try {
		const result = await $`bunx convex env list`.cwd(DATABASE_DIR).text();
		for (const line of result.split("\n")) {
			const eqIdx = line.indexOf("=");
			if (eqIdx === -1) continue;
			vars.set(line.slice(0, eqIdx), line.slice(eqIdx + 1));
		}
	} catch {
		fail("Could not fetch Convex env vars (is `bunx convex` configured?)");
		failures++;
	}
	return vars;
};

// ---------------------------------------------------------------------------
// 3. Check GitHub App via gh CLI
// ---------------------------------------------------------------------------

const checkGitHubApp = async (slug: string) => {
	try {
		const result =
			await $`gh api /apps/${slug} --jq '.name,.id,.slug,.html_url'`.text();
		const lines = result.trim().split("\n");
		if (lines.length >= 2) {
			pass(`GitHub App found: ${lines[0]} (id: ${lines[1]})`);
			if (lines[3]) info(`URL: ${lines[3]}`);
			return lines[1]; // app id
		}
		fail(`GitHub App "${slug}" returned unexpected data`);
		failures++;
		return null;
	} catch {
		fail(`GitHub App "${slug}" not found or \`gh\` CLI not authenticated`);
		failures++;
		return null;
	}
};

const checkGitHubAppInstallations = async (slug: string) => {
	try {
		const result =
			await $`gh api /user/installations --jq '.installations[] | select(.app_slug == "${slug}") | "\(.id) \(.account.login) \(.account.type)"'`.text();
		const lines = result.trim().split("\n").filter(Boolean);
		if (lines.length > 0) {
			pass(`Found ${lines.length} installation(s):`);
			for (const line of lines) {
				const parts = line.split(" ");
				info(`Installation ${parts[0]}: ${parts[1]} (${parts[2]})`);
			}
		} else {
			warn(
				"No installations found for your GitHub account. Install the app first.",
			);
			warnings++;
		}
	} catch {
		warn("Could not list installations (may need 'read:org' scope on gh CLI)");
		warnings++;
	}
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("\x1b[1m🔍 QuickHub GitHub App Configuration Check\x1b[0m");

// --- Local .env ---

heading("Local .env file");

const envPath = join(ROOT, ".env");
const envVars = parseEnvFile(envPath);

check(
	existsSync(envPath),
	".env file exists",
	".env file not found at repo root",
);

const envWebhookSecret = envVars.get("GITHUB_WEBHOOK_SECRET");
check(
	!!envWebhookSecret &&
		envWebhookSecret !== "generate-with-openssl-rand-hex-32",
	"GITHUB_WEBHOOK_SECRET is set",
	"GITHUB_WEBHOOK_SECRET is missing or still has placeholder value",
);

const envClientId = envVars.get("GITHUB_CLIENT_ID");
check(
	!!envClientId && envClientId !== "your-github-oauth-app-client-id",
	`GITHUB_CLIENT_ID is set (${envClientId?.slice(0, 8)}...)`,
	"GITHUB_CLIENT_ID is missing or still has placeholder value",
);

const envClientSecret = envVars.get("GITHUB_CLIENT_SECRET");
check(
	!!envClientSecret &&
		envClientSecret !== "your-github-oauth-app-client-secret",
	"GITHUB_CLIENT_SECRET is set",
	"GITHUB_CLIENT_SECRET is missing or still has placeholder value",
);

const envAppSlug = envVars.get("GITHUB_APP_SLUG");
check(
	!!envAppSlug && envAppSlug !== "your-github-app-slug",
	`GITHUB_APP_SLUG is set: ${envAppSlug}`,
	"GITHUB_APP_SLUG is missing or still has placeholder value",
);

const envSiteUrl = envVars.get("SITE_URL");
check(!!envSiteUrl, `SITE_URL is set: ${envSiteUrl}`, "SITE_URL is missing");

// --- Convex env vars ---

heading("Convex environment variables");

const convexVars = await getConvexEnvVars();

if (convexVars.size > 0) {
	pass(`Loaded ${convexVars.size} Convex env var(s)`);

	const cvxWebhookSecret = convexVars.get("GITHUB_WEBHOOK_SECRET");
	check(
		!!cvxWebhookSecret,
		"GITHUB_WEBHOOK_SECRET is set in Convex",
		"GITHUB_WEBHOOK_SECRET is MISSING in Convex — webhooks will fail with HTTP 500",
	);

	if (envWebhookSecret && cvxWebhookSecret) {
		check(
			envWebhookSecret === cvxWebhookSecret,
			"GITHUB_WEBHOOK_SECRET matches between .env and Convex",
			"GITHUB_WEBHOOK_SECRET MISMATCH between .env and Convex — webhook signature verification will fail",
		);
	}

	const cvxClientId = convexVars.get("GITHUB_CLIENT_ID");
	check(
		!!cvxClientId,
		`GITHUB_CLIENT_ID is set in Convex (${cvxClientId?.slice(0, 8)}...)`,
		"GITHUB_CLIENT_ID is MISSING in Convex — GitHub OAuth sign-in will fail",
	);

	const cvxClientSecret = convexVars.get("GITHUB_CLIENT_SECRET");
	check(
		!!cvxClientSecret,
		"GITHUB_CLIENT_SECRET is set in Convex",
		"GITHUB_CLIENT_SECRET is MISSING in Convex — GitHub OAuth sign-in will fail",
	);

	const cvxAppId = convexVars.get("GITHUB_APP_ID");
	check(
		!!cvxAppId,
		`GITHUB_APP_ID is set in Convex: ${cvxAppId}`,
		"GITHUB_APP_ID is MISSING in Convex — installation token requests will fail (webhooks will not be able to sync repo data)",
	);

	const cvxPrivateKey = convexVars.get("GITHUB_APP_PRIVATE_KEY");
	check(
		!!cvxPrivateKey,
		"GITHUB_APP_PRIVATE_KEY is set in Convex",
		"GITHUB_APP_PRIVATE_KEY is MISSING in Convex — installation token requests will fail",
	);

	if (cvxPrivateKey) {
		const looksLikePem =
			cvxPrivateKey.includes("BEGIN") && cvxPrivateKey.includes("KEY");
		check(
			looksLikePem,
			"GITHUB_APP_PRIVATE_KEY looks like a valid PEM key",
			'GITHUB_APP_PRIVATE_KEY does not look like a PEM key — should start with "-----BEGIN RSA PRIVATE KEY-----"',
		);
	}

	const cvxSiteUrl = convexVars.get("SITE_URL");
	check(
		!!cvxSiteUrl,
		`SITE_URL is set in Convex: ${cvxSiteUrl}`,
		"SITE_URL is MISSING in Convex — Better Auth OAuth redirects will fail",
	);

	const cvxBetterAuthSecret = convexVars.get("BETTER_AUTH_SECRET");
	check(
		!!cvxBetterAuthSecret,
		"BETTER_AUTH_SECRET is set in Convex",
		"BETTER_AUTH_SECRET is MISSING in Convex — authentication will fail",
	);

	// Optional vars
	softCheck(
		!!convexVars.get("GITHUB_NOTIFICATIONS_CLIENT_ID"),
		"GITHUB_NOTIFICATIONS_CLIENT_ID is set in Convex (optional)",
		"GITHUB_NOTIFICATIONS_CLIENT_ID is not set in Convex (notifications feature will be disabled)",
	);
	softCheck(
		!!convexVars.get("GITHUB_NOTIFICATIONS_CLIENT_SECRET"),
		"GITHUB_NOTIFICATIONS_CLIENT_SECRET is set in Convex (optional)",
		"GITHUB_NOTIFICATIONS_CLIENT_SECRET is not set in Convex (notifications feature will be disabled)",
	);
}

// --- GitHub App reachability ---

heading("GitHub App");

if (envAppSlug) {
	const appId = await checkGitHubApp(envAppSlug);

	// Cross-check app ID
	const cvxAppId = convexVars.get("GITHUB_APP_ID");
	if (appId && cvxAppId) {
		check(
			appId === cvxAppId,
			`GITHUB_APP_ID matches: local GitHub App ID (${appId}) = Convex env (${cvxAppId})`,
			`GITHUB_APP_ID MISMATCH: GitHub reports ID ${appId} but Convex has ${cvxAppId}`,
		);
	}

	await checkGitHubAppInstallations(envAppSlug);
} else {
	fail("Cannot check GitHub App — GITHUB_APP_SLUG not set");
	failures++;
}

// --- Webhook URL ---

heading("Webhook configuration");

const convexSiteUrl = envVars.get("CONVEX_SITE_URL");
if (convexSiteUrl) {
	info(`Expected webhook URL: ${convexSiteUrl}/api/github/webhook`);
	info(
		"Verify this URL is configured in your GitHub App settings under 'Webhook URL'",
	);
} else {
	warn("CONVEX_SITE_URL not set in .env — cannot determine webhook URL");
	warnings++;
}

info("Required webhook events: installation, installation_repositories,");
info("  issues, pull_request, push, check_run, member, workflow_job,");
info("  issue_comment, pull_request_review");

// --- Summary ---

heading("Summary");

if (failures === 0 && warnings === 0) {
	console.log(
		"\x1b[32m  All checks passed! Your GitHub App configuration looks good.\x1b[0m",
	);
} else {
	if (failures > 0) {
		console.log(
			`\x1b[31m  ${failures} check(s) failed — fix these to get the GitHub App working.\x1b[0m`,
		);
	}
	if (warnings > 0) {
		console.log(
			`\x1b[33m  ${warnings} warning(s) — optional items that may affect some features.\x1b[0m`,
		);
	}
}

console.log("");

process.exit(failures > 0 ? 1 : 0);
