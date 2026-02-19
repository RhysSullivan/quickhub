import { createSearchParamsCache, parseAsStringLiteral } from "nuqs/server";

/** State filter values for PR and issue lists */
export const STATE_FILTERS = ["all", "open", "closed"] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];

/** Shared parsers for state filter on PR/issue list pages */
export const stateFilterParsers = {
	state: parseAsStringLiteral(STATE_FILTERS).withDefault("open"),
};

/** Server-side search params cache for list pages */
export const stateFilterSearchParamsCache =
	createSearchParamsCache(stateFilterParsers);
