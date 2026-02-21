import { describe, expect, it } from "vitest";
import {
	buildCanonicalGitHubSearch,
	parseSearchCommandQuery,
} from "./search-command-dsl";

describe("parseSearchCommandQuery", () => {
	it("parses provider, target, and author", () => {
		const parsed = parseSearchCommandQuery("github issues by elliot");

		expect(parsed.provider).toBe("github");
		expect(parsed.target).toBe("issue");
		expect(parsed.author).toBe("elliot");
		expect(parsed.textTokens).toEqual([]);
	});

	it("parses repo-scoped PR filters", () => {
		const now = new Date("2026-02-21T12:00:00.000Z").getTime();
		const expected = new Date(now);
		expected.setHours(0, 0, 0, 0);
		expected.setDate(expected.getDate() - 7);
		const parsed = parseSearchCommandQuery(
			"prs assigned to @elliot in vercel/next.js label bug merged last week",
			now,
		);

		expect(parsed.target).toBe("pr");
		expect(parsed.assignee).toBe("elliot");
		expect(parsed.repo).toEqual({ owner: "vercel", name: "next.js" });
		expect(parsed.labels).toEqual(["bug"]);
		expect(parsed.state).toBe("merged");
		expect(parsed.updatedAfter).toBe(expected.getTime());
		expect(parsed.textTokens).toEqual([]);
	});

	it("keeps plain text when no DSL exists", () => {
		const parsed = parseSearchCommandQuery("fix flaky tests");

		expect(parsed.hasDsl).toBe(false);
		expect(parsed.textTokens).toEqual(["fix", "flaky", "tests"]);
	});

	it("builds canonical query from parsed filters", () => {
		const now = new Date("2026-02-21T12:00:00.000Z").getTime();
		const parsed = parseSearchCommandQuery(
			'gh issues by elliot label "good first issue" past 30 days',
			now,
		);
		const canonical = buildCanonicalGitHubSearch(parsed, {
			owner: "quickhub",
			name: "quickhub",
		});

		expect(canonical).toContain("is:issue");
		expect(canonical).toContain("author:elliot");
		expect(canonical).toContain('label:"good first issue"');
		expect(canonical).toContain("updated:>=2026-01-22");
		expect(canonical).toContain("repo:quickhub/quickhub");
	});
});
