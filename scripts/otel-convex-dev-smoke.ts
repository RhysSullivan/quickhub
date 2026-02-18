import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/database/convex/_generated/api";

const CONTAINER_NAME =
	process.env.CONVEX_LOCAL_CONTAINER_NAME ?? "convex-otel-smoke";
const CONVEX_IMAGE =
	process.env.CONVEX_LOCAL_IMAGE ?? "ghcr.io/get-convex/convex-backend:latest";
const BACKEND_PORT = Number(process.env.CONVEX_LOCAL_BACKEND_PORT ?? "3210");
const SITE_PROXY_PORT = Number(
	process.env.CONVEX_LOCAL_SITE_PROXY_PORT ?? "3211",
);
const KEEP_CONTAINER = process.env.CONVEX_LOCAL_KEEP_CONTAINER === "true";
const CONVEX_LOCAL_URL = `http://127.0.0.1:${String(BACKEND_PORT)}`;

const DEPLOY_RETRY_ATTEMPTS = Number(
	process.env.CONVEX_LOCAL_DEPLOY_RETRY_ATTEMPTS ?? "2",
);
const HEALTH_CHECK_ATTEMPTS = Number(
	process.env.CONVEX_LOCAL_HEALTH_ATTEMPTS ?? "30",
);
const HEALTH_CHECK_DELAY_MS = Number(
	process.env.CONVEX_LOCAL_HEALTH_DELAY_MS ?? "1000",
);

const OTEL_CONSOLE_MARKER = "__OTEL_SPAN__";

const parseOtelSpanName = (line: string): string | null => {
	const markerIndex = line.indexOf(OTEL_CONSOLE_MARKER);
	if (markerIndex < 0) {
		return null;
	}

	const payload = line.slice(markerIndex + OTEL_CONSOLE_MARKER.length);
	try {
		const parsed = JSON.parse(payload);
		if (typeof parsed === "object" && parsed !== null) {
			const name = Reflect.get(parsed, "name");
			if (typeof name === "string") {
				return name;
			}
		}
		return null;
	} catch {
		return null;
	}
};

const runCommand = (
	command: string,
	args: Array<string>,
	options: {
		readonly cwd?: string;
		readonly env?: NodeJS.ProcessEnv;
		readonly allowFailure?: boolean;
	} = {},
) => {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env,
		encoding: "utf8",
	});

	if (result.status !== 0 && options.allowFailure !== true) {
		const stderr = result.stderr.trim();
		const stdout = result.stdout.trim();
		const details = stderr.length > 0 ? stderr : stdout;
		throw new Error(`Command failed: ${command} ${args.join(" ")}\n${details}`);
	}

	return {
		status: result.status,
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
	};
};

const delay = (ms: number) =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const waitForBackend = async () => {
	for (let attempt = 1; attempt <= HEALTH_CHECK_ATTEMPTS; attempt += 1) {
		try {
			const response = await fetch(`${CONVEX_LOCAL_URL}/version`);
			if (response.ok) {
				return;
			}
		} catch {
			// Continue waiting.
		}

		await delay(HEALTH_CHECK_DELAY_MS);
	}

	throw new Error(
		`Convex backend did not become healthy at ${CONVEX_LOCAL_URL}.`,
	);
};

const getAdminKey = (): string => {
	const result = runCommand("docker", [
		"exec",
		CONTAINER_NAME,
		"./generate_admin_key.sh",
	]);

	const lines = result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const key = lines.length > 0 ? lines[lines.length - 1] : "";
	if (key.length === 0) {
		throw new Error("Failed to read admin key from local Convex backend.");
	}

	return key;
};

const deploySchemaAndFunctions = (adminKey: string) => {
	const env = {
		...process.env,
		CONVEX_SELF_HOSTED_URL: CONVEX_LOCAL_URL,
		CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
	};

	for (let attempt = 1; attempt <= DEPLOY_RETRY_ATTEMPTS; attempt += 1) {
		const result = runCommand(
			"bunx",
			[
				"convex",
				"dev",
				"--once",
				"--typecheck",
				"disable",
				"--codegen",
				"disable",
				"--tail-logs",
				"disable",
			],
			{
				cwd: "/home/rhys/create-epoch-app/packages/database",
				env,
				allowFailure: true,
			},
		);

		if (result.status === 0) {
			return;
		}

		if (attempt < DEPLOY_RETRY_ATTEMPTS) {
			continue;
		}

		const details = result.stderr.length > 0 ? result.stderr : result.stdout;
		throw new Error(`Failed to deploy to local Convex:\n${details}`);
	}
};

const assertTelemetryInLogs = (sinceIso: string) => {
	const logs = runCommand("docker", [
		"logs",
		"--since",
		sinceIso,
		CONTAINER_NAME,
	]);

	const lines = logs.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	let addSpanSeen = false;
	let listPaginatedSpanSeen = false;

	for (const line of lines) {
		const spanName = parseOtelSpanName(line);
		if (spanName === "rpc.server.mutation.add") {
			addSpanSeen = true;
		}
		if (spanName === "rpc.server.query.listPaginated") {
			listPaginatedSpanSeen = true;
		}
	}

	if (!addSpanSeen || !listPaginatedSpanSeen) {
		throw new Error(
			`OTEL spans not found in local backend logs. addSpanSeen=${String(addSpanSeen)} listPaginatedSpanSeen=${String(listPaginatedSpanSeen)}.`,
		);
	}
};

const startContainer = () => {
	runCommand("docker", ["rm", "-f", CONTAINER_NAME], {
		allowFailure: true,
	});

	runCommand("docker", [
		"run",
		"-d",
		"--name",
		CONTAINER_NAME,
		"-e",
		"CONVEX_OTEL_ENABLED=true",
		"-p",
		`${String(BACKEND_PORT)}:3210`,
		"-p",
		`${String(SITE_PROXY_PORT)}:3211`,
		CONVEX_IMAGE,
	]);
};

const stopContainer = () => {
	if (KEEP_CONTAINER) {
		return;
	}

	runCommand("docker", ["rm", "-f", CONTAINER_NAME], {
		allowFailure: true,
	});
};

runCommand("docker", ["--version"]);

const smokeStartIso = new Date().toISOString();
startContainer();

try {
	await waitForBackend();
	const adminKey = getAdminKey();
	deploySchemaAndFunctions(adminKey);

	const marker = `otel-local-smoke-${Date.now()}`;
	const client = new ConvexHttpClient(CONVEX_LOCAL_URL);

	await client.mutation(api.rpc.guestbook.add, {
		name: marker,
		message: marker,
	});

	await client.query(api.rpc.guestbook.listPaginated, {
		cursor: null,
		numItems: 3,
	});

	await delay(1_000);
	assertTelemetryInLogs(smokeStartIso);

	console.log(
		`Local Convex OTEL smoke passed at ${CONVEX_LOCAL_URL}. container=${CONTAINER_NAME}`,
	);
} finally {
	stopContainer();
}
