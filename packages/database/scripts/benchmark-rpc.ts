#!/usr/bin/env bun
/// <reference types="node" />
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const CONVEX_URL =
	process.env.CONVEX_URL || "https://healthy-albatross-147.convex.cloud";
const ITERATIONS = 50;

interface BenchmarkResult {
	name: string;
	avg: number;
	min: number;
	max: number;
	p50: number;
	p95: number;
	p99: number;
}

async function benchmark(
	name: string,
	fn: () => Promise<unknown>,
): Promise<BenchmarkResult> {
	const times: Array<number> = [];

	console.log(`Warming up ${name}...`);
	for (let i = 0; i < 3; i++) {
		await fn();
	}

	console.log(`Running ${ITERATIONS} iterations of ${name}...`);
	for (let i = 0; i < ITERATIONS; i++) {
		const start = performance.now();
		await fn();
		times.push(performance.now() - start);
	}

	const avg = times.reduce((a, b) => a + b, 0) / times.length;
	const min = Math.min(...times);
	const max = Math.max(...times);
	const sorted = [...times].sort((a, b) => a - b);
	const p50 = sorted[Math.floor(times.length * 0.5)]!;
	const p95 = sorted[Math.floor(times.length * 0.95)]!;
	const p99 = sorted[Math.floor(times.length * 0.99)]!;

	console.log(`${name}:`);
	console.log(`  avg: ${avg.toFixed(2)}ms`);
	console.log(`  min: ${min.toFixed(2)}ms, max: ${max.toFixed(2)}ms`);
	console.log(
		`  p50: ${p50.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms, p99: ${p99.toFixed(2)}ms`,
	);
	console.log();

	return { name, avg, min, max, p50, p95, p99 };
}

async function main() {
	console.log(`Connecting to Convex at ${CONVEX_URL}...`);
	console.log("Using ConvexHttpClient for true HTTP roundtrip benchmarks\n");
	const client = new ConvexHttpClient(CONVEX_URL);

	const results: Array<BenchmarkResult> = [];

	results.push(
		await benchmark("Vanilla Convex Query", () =>
			client.query(api.rpc.benchmark.vanillaList, {}),
		),
	);

	results.push(
		await benchmark("Confect Query", () =>
			client.query(api.rpc.benchmark.confectList, {}),
		),
	);

	results.push(
		await benchmark("RPC Query", () =>
			client.query(api.rpc.benchmark.rpcList, { payload: null }),
		),
	);

	console.log("=== SUMMARY ===\n");
	console.log("| Method | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) |");
	console.log("|--------|----------|----------|----------|----------|");
	for (const r of results) {
		console.log(
			`| ${r.name.padEnd(25)} | ${r.avg.toFixed(2).padStart(8)} | ${r.p50.toFixed(2).padStart(8)} | ${r.p95.toFixed(2).padStart(8)} | ${r.p99.toFixed(2).padStart(8)} |`,
		);
	}

	const baseline = results[0]!.avg;
	console.log("\n=== OVERHEAD vs VANILLA ===\n");
	for (const r of results.slice(1)) {
		const overhead = r.avg - baseline;
		const pct = (overhead / baseline) * 100;
		console.log(
			`${r.name}: ${overhead >= 0 ? "+" : ""}${overhead.toFixed(2)}ms (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`,
		);
	}
}

main().catch(console.error);
