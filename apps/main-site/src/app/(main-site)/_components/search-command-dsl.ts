type SearchTarget = "issue" | "pr" | "repo";
type SearchState = "open" | "closed" | "merged";

type RepoRef = {
	readonly owner: string;
	readonly name: string;
};

export type SearchCommandQuery = {
	readonly provider: "github" | null;
	readonly target: SearchTarget | null;
	readonly repo: RepoRef | null;
	readonly org: string | null;
	readonly author: string | null;
	readonly assignee: string | null;
	readonly labels: ReadonlyArray<string>;
	readonly state: SearchState | null;
	readonly updatedAfter: number | null;
	readonly textTokens: ReadonlyArray<string>;
	readonly hasDsl: boolean;
};

const normalize = (value: string) => value.trim().replace(/\s+/g, " ");

const startOfDay = (timestamp: number) => {
	const date = new Date(timestamp);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
};

const daysAgo = (dayCount: number, now: number) => {
	const date = new Date(startOfDay(now));
	date.setDate(date.getDate() - dayCount);
	return date.getTime();
};

const parseIsoDateToStartOfDay = (value: string): number | null => {
	const date = new Date(`${value}T00:00:00`);
	if (Number.isNaN(date.getTime())) return null;
	return date.getTime();
};

type ParseMutableState = {
	remaining: string;
	recognizedTokens: number;
	provider: "github" | null;
	target: SearchTarget | null;
	repo: RepoRef | null;
	org: string | null;
	author: string | null;
	assignee: string | null;
	labels: Array<string>;
	state: SearchState | null;
	updatedAfter: number | null;
};

const eatAll = (
	state: ParseMutableState,
	pattern: RegExp,
	handler: (match: RegExpExecArray) => void,
) => {
	let match = pattern.exec(state.remaining);
	while (match !== null) {
		handler(match);
		state.recognizedTokens += 1;
		state.remaining = normalize(
			`${state.remaining.slice(0, match.index)} ${state.remaining.slice(match.index + match[0].length)}`,
		);
		pattern.lastIndex = 0;
		match = pattern.exec(state.remaining);
	}
};

const formatYmd = (timestamp: number) => {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
};

export const parseSearchCommandQuery = (
	rawInput: string,
	now = Date.now(),
): SearchCommandQuery => {
	const state: ParseMutableState = {
		remaining: normalize(rawInput.toLowerCase()),
		recognizedTokens: 0,
		provider: null,
		target: null,
		repo: null,
		org: null,
		author: null,
		assignee: null,
		labels: [],
		state: null,
		updatedAfter: null,
	};

	if (state.remaining.length === 0) {
		return {
			provider: null,
			target: null,
			repo: null,
			org: null,
			author: null,
			assignee: null,
			labels: [],
			state: null,
			updatedAfter: null,
			textTokens: [],
			hasDsl: false,
		};
	}

	state.remaining = state.remaining.replace(/^(github|gh)\b\s*/, () => {
		state.provider = "github";
		state.recognizedTokens += 1;
		return "";
	});
	state.remaining = normalize(state.remaining);

	state.remaining = state.remaining.replace(
		/^(issues?|prs?|pulls?|pull requests?|repositories?|repos?)\b\s*/,
		(match) => {
			if (match.startsWith("issue")) state.target = "issue";
			if (match.startsWith("pr") || match.startsWith("pull"))
				state.target = "pr";
			if (match.startsWith("repo") || match.startsWith("repositor"))
				state.target = "repo";
			state.recognizedTokens += 1;
			return "";
		},
	);
	state.remaining = normalize(state.remaining);

	eatAll(state, /\bmerged\b/g, () => {
		state.state = "merged";
	});
	eatAll(state, /\bclosed\b/g, () => {
		state.state = "closed";
	});
	eatAll(state, /\b(open|opened)\b/g, () => {
		state.state = "open";
	});

	eatAll(state, /\bassigned to\s+@?([\w-]+)\b/g, (match) => {
		state.assignee = match[1] ?? null;
	});
	eatAll(state, /\b(by|from|authored by)\s+@?([\w-]+)\b/g, (match) => {
		state.author = match[2] ?? null;
	});

	eatAll(state, /\b(repo|in)\s+([\w.-]+)\/([\w.-]+)\b/g, (match) => {
		const owner = match[2];
		const name = match[3];
		if (owner !== undefined && name !== undefined) {
			state.repo = { owner, name };
		}
	});
	eatAll(state, /\borg\s+([\w.-]+)\b/g, (match) => {
		state.org = match[1] ?? null;
	});
	eatAll(state, /\bin\s+([\w.-]+)\b/g, (match) => {
		if (state.repo === null) state.org = match[1] ?? null;
	});

	eatAll(state, /\b(label|tag)\s+"([^"]+)"/g, (match) => {
		const label = match[2]?.trim();
		if (label !== undefined && label.length > 0) state.labels.push(label);
	});
	eatAll(state, /\b(label|tag)\s+([\w-]+)\b/g, (match) => {
		const label = match[2]?.trim();
		if (label !== undefined && label.length > 0) state.labels.push(label);
	});

	eatAll(
		state,
		/\b(?:updated\s+)?past\s+(\d+)\s*(?:d|day|days)\b/g,
		(match) => {
			const value = Number(match[1]);
			if (Number.isFinite(value) && value >= 0) {
				state.updatedAfter = daysAgo(value, now);
			}
		},
	);
	eatAll(state, /\b(?:updated\s+)?last\s+week\b/g, () => {
		state.updatedAfter = daysAgo(7, now);
	});
	eatAll(state, /\b(?:updated\s+)?last\s+month\b/g, () => {
		state.updatedAfter = daysAgo(30, now);
	});
	eatAll(state, /\b(?:updated\s+)?yesterday\b/g, () => {
		state.updatedAfter = daysAgo(1, now);
	});
	eatAll(state, /\b(?:updated\s+)?today\b/g, () => {
		state.updatedAfter = daysAgo(0, now);
	});
	eatAll(state, /\bsince\s+yesterday\b/g, () => {
		state.updatedAfter = daysAgo(1, now);
	});
	eatAll(state, /\bsince\s+today\b/g, () => {
		state.updatedAfter = daysAgo(0, now);
	});
	eatAll(state, /\bsince\s+(\d{4}-\d{2}-\d{2})\b/g, (match) => {
		const parsed = parseIsoDateToStartOfDay(match[1] ?? "");
		if (parsed !== null) state.updatedAfter = parsed;
	});

	const textTokens = state.remaining.length
		? state.remaining.split(" ").filter((token) => token.length > 0)
		: [];

	return {
		provider: state.provider,
		target: state.target,
		repo: state.repo,
		org: state.org,
		author: state.author,
		assignee: state.assignee,
		labels: state.labels,
		state: state.state,
		updatedAfter: state.updatedAfter,
		textTokens,
		hasDsl: state.recognizedTokens > 0,
	};
};

export const buildCanonicalGitHubSearch = (
	query: SearchCommandQuery,
	fallbackRepo: RepoRef | null,
) => {
	const parts: Array<string> = [];
	if (query.target === "issue") parts.push("is:issue");
	if (query.target === "pr") parts.push("is:pr");
	if (query.repo !== null)
		parts.push(`repo:${query.repo.owner}/${query.repo.name}`);
	if (query.repo === null && fallbackRepo !== null)
		parts.push(`repo:${fallbackRepo.owner}/${fallbackRepo.name}`);
	if (query.org !== null) parts.push(`org:${query.org}`);
	if (query.author !== null) parts.push(`author:${query.author}`);
	if (query.assignee !== null) parts.push(`assignee:${query.assignee}`);
	for (const label of query.labels) {
		parts.push(`label:${label.includes(" ") ? `"${label}"` : label}`);
	}
	if (query.state === "open") parts.push("is:open");
	if (query.state === "closed") parts.push("is:closed");
	if (query.state === "merged") parts.push("is:merged");
	if (query.updatedAfter !== null) {
		parts.push(`updated:>=${formatYmd(query.updatedAfter)}`);
	}
	for (const token of query.textTokens) {
		parts.push(token.includes(" ") ? `"${token}"` : token);
	}
	return parts.join(" ");
};
