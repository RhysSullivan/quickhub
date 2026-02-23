export function resolveSetupRedirectPath(state: string | null, requestUrl: URL) {
	if (!state) return "/";

	try {
		if (state.startsWith("/") && !state.startsWith("//")) {
			return state;
		}

		const candidate = new URL(state);
		if (candidate.origin !== requestUrl.origin) {
			return "/";
		}
		return `${candidate.pathname}${candidate.search}${candidate.hash}`;
	} catch {
		return "/";
	}
}
