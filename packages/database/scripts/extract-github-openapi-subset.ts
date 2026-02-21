/**
 * Extract a subset of the GitHub OpenAPI spec containing only the endpoints
 * we actually use. Recursively resolves $ref dependencies to include all
 * required schema definitions.
 *
 * Usage: bun run scripts/extract-github-openapi-subset.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FULL_SPEC_PATH = "/tmp/github-openapi-full.json";
const OUTPUT_PATH = resolve(
	import.meta.dirname,
	"../convex/shared/github-openapi-subset.json",
);

// The paths we use, mapped to the HTTP methods we need for each
const PATHS_AND_METHODS: Record<string, ReadonlyArray<string>> = {
	"/app/installations/{installation_id}/access_tokens": ["post"],
	"/repos/{owner}/{repo}": ["get"],
	"/repos/{owner}/{repo}/branches": ["get"],
	"/repos/{owner}/{repo}/pulls": ["get"],
	"/repos/{owner}/{repo}/pulls/{pull_number}": ["get"],
	"/repos/{owner}/{repo}/pulls/{pull_number}/merge": ["put"],
	"/repos/{owner}/{repo}/pulls/{pull_number}/reviews": ["get", "post"],
	"/repos/{owner}/{repo}/pulls/{pull_number}/comments": ["get"],
	"/repos/{owner}/{repo}/pulls/{pull_number}/files": ["get"],
	"/repos/{owner}/{repo}/issues": ["get", "post"],
	"/repos/{owner}/{repo}/issues/{issue_number}": ["get", "patch"],
	"/repos/{owner}/{repo}/issues/{issue_number}/comments": ["get", "post"],
	"/repos/{owner}/{repo}/issues/{issue_number}/labels": ["get", "post"],
	"/repos/{owner}/{repo}/issues/{issue_number}/labels/{name}": ["delete"],
	"/repos/{owner}/{repo}/issues/{issue_number}/assignees": ["post", "delete"],
	"/repos/{owner}/{repo}/commits": ["get"],
	"/repos/{owner}/{repo}/commits/{ref}/check-runs": ["get"],
	"/repos/{owner}/{repo}/actions/runs": ["get"],
	"/repos/{owner}/{repo}/actions/runs/{run_id}/jobs": ["get"],
	"/repos/{owner}/{repo}/git/trees/{tree_sha}": ["get"],
	"/repos/{owner}/{repo}/contents/{path}": ["get"],
	"/repos/{owner}/{repo}/hooks": ["post"],
	"/notifications": ["get"],
	"/notifications/threads/{thread_id}": ["patch"],
	"/user/repos": ["get"],
};

const fullSpec = JSON.parse(readFileSync(FULL_SPEC_PATH, "utf-8"));

// Collect all $ref strings found in an object
function collectRefs(obj: unknown, refs: Set<string>): void {
	if (obj === null || typeof obj !== "object") return;
	if (Array.isArray(obj)) {
		for (const item of obj) collectRefs(item, refs);
		return;
	}
	const record = obj as Record<string, unknown>;
	if (typeof record.$ref === "string") {
		refs.add(record.$ref);
	}
	for (const value of Object.values(record)) {
		collectRefs(value, refs);
	}
}

// Resolve a $ref path like "#/components/schemas/Foo" to the actual object
function resolveRef(ref: string): unknown {
	const parts = ref.replace("#/", "").split("/");
	let current: unknown = fullSpec;
	for (const part of parts) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

// Build the subset spec
const subset: Record<string, unknown> = {
	openapi: fullSpec.openapi,
	info: {
		title: "GitHub REST API (QuickHub subset)",
		version: fullSpec.info?.version ?? "1.0.0",
	},
	servers: fullSpec.servers,
	paths: {} as Record<string, unknown>,
	components: {
		schemas: {} as Record<string, unknown>,
		parameters: {} as Record<string, unknown>,
		responses: {} as Record<string, unknown>,
		headers: {} as Record<string, unknown>,
		securitySchemes: {} as Record<string, unknown>,
	},
};

const paths = subset.paths as Record<string, Record<string, unknown>>;
const components = subset.components as Record<string, Record<string, unknown>>;

// Step 1: Extract only the methods we need from each path
for (const [path, methods] of Object.entries(PATHS_AND_METHODS)) {
	const fullPath = fullSpec.paths[path];
	if (!fullPath) {
		console.warn(`WARNING: Path not found in spec: ${path}`);
		continue;
	}
	const filteredPath: Record<string, unknown> = {};
	// Include path-level parameters
	if (fullPath.parameters) {
		filteredPath.parameters = fullPath.parameters;
	}
	for (const method of methods) {
		if (fullPath[method]) {
			filteredPath[method] = fullPath[method];
		} else {
			console.warn(`WARNING: Method ${method} not found for path: ${path}`);
		}
	}
	paths[path] = filteredPath;
}

// Step 2: Iteratively resolve all $ref dependencies
const resolvedRefs = new Set<string>();
let changed = true;

while (changed) {
	changed = false;
	const refs = new Set<string>();
	collectRefs(subset, refs);

	for (const ref of refs) {
		if (resolvedRefs.has(ref)) continue;
		resolvedRefs.add(ref);

		// Parse ref like "#/components/schemas/Foo"
		const parts = ref.replace("#/", "").split("/");
		if (parts[0] !== "components" || parts.length < 3) continue;

		const componentType = parts[1]; // schemas, parameters, responses, headers
		const componentName = parts.slice(2).join("/");

		if (!components[componentType]) {
			components[componentType] = {};
		}

		if (!components[componentType][componentName]) {
			const resolved = resolveRef(ref);
			if (resolved) {
				components[componentType][componentName] = resolved;
				changed = true; // New component added, may introduce new refs
			} else {
				console.warn(`WARNING: Could not resolve $ref: ${ref}`);
			}
		}
	}
}

// Clean up empty component sections
for (const [key, value] of Object.entries(components)) {
	if (
		typeof value === "object" &&
		value !== null &&
		Object.keys(value).length === 0
	) {
		delete components[key];
	}
}

const output = JSON.stringify(subset, null, 2);
writeFileSync(OUTPUT_PATH, output);

const pathCount = Object.keys(paths).length;
const schemaCount = Object.keys(components.schemas ?? {}).length;
const paramCount = Object.keys(components.parameters ?? {}).length;
const responseCount = Object.keys(components.responses ?? {}).length;
console.log(
	`Extracted ${pathCount} paths, ${schemaCount} schemas, ${paramCount} parameters, ${responseCount} responses`,
);
console.log(`Output: ${OUTPUT_PATH} (${(output.length / 1024).toFixed(0)} KB)`);
