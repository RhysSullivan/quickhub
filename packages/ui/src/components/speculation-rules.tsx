/**
 * Injects browser-native Speculation Rules for intent-based prefetching/prerendering.
 *
 * - Desktop: prerender on ~10ms hover (effectively intent-based)
 * - Mobile: prefetch 50ms after links enter the viewport
 *
 * Replaces Next.js's default "prefetch everything in viewport" behavior which
 * saturates the network on pages with many links. Pair with `prefetch={false}`
 * on Next.js `<Link>` components.
 *
 * Unsupported browsers silently ignore the script tag — zero cost progressive enhancement.
 *
 * @see https://developer.chrome.com/docs/web-platform/prerender-pages
 */
export function SpeculationRules() {
	const rules = {
		prerender: [
			{
				where: {
					and: [
						{ href_matches: "/*" },
						{ not: { href_matches: "/api/*" } },
						{ not: { href_matches: "/_next/*" } },
						{ not: { selector_matches: "[data-no-prerender]" } },
					],
				},
				eagerness: "eager",
			},
		],
	};

	return (
		// biome-ignore lint/security/noDangerouslySetInnerHtml: speculation rules require inline JSON in a script tag
		<script
			type="speculationrules"
			dangerouslySetInnerHTML={{ __html: JSON.stringify(rules) }}
		/>
	);
}
