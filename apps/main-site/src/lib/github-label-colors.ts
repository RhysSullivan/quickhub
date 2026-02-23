const githubLabelColorClassByName: Record<string, string> = {
	bug: "border-[var(--github-label-bug-border)] bg-[var(--github-label-bug-bg)] text-[var(--github-label-bug-fg)]",
	documentation:
		"border-[var(--github-label-documentation-border)] bg-[var(--github-label-documentation-bg)] text-[var(--github-label-documentation-fg)]",
	duplicate:
		"border-[var(--github-label-duplicate-border)] bg-[var(--github-label-duplicate-bg)] text-[var(--github-label-duplicate-fg)]",
	enhancement:
		"border-[var(--github-label-enhancement-border)] bg-[var(--github-label-enhancement-bg)] text-[var(--github-label-enhancement-fg)]",
	"good first issue":
		"border-[var(--github-label-good-first-issue-border)] bg-[var(--github-label-good-first-issue-bg)] text-[var(--github-label-good-first-issue-fg)]",
	"help wanted":
		"border-[var(--github-label-help-wanted-border)] bg-[var(--github-label-help-wanted-bg)] text-[var(--github-label-help-wanted-fg)]",
	invalid:
		"border-[var(--github-label-invalid-border)] bg-[var(--github-label-invalid-bg)] text-[var(--github-label-invalid-fg)]",
	question:
		"border-[var(--github-label-question-border)] bg-[var(--github-label-question-bg)] text-[var(--github-label-question-fg)]",
	wontfix:
		"border-[var(--github-label-wontfix-border)] bg-[var(--github-label-wontfix-bg)] text-[var(--github-label-wontfix-fg)]",
	core: "border-[var(--github-label-core-border)] bg-[var(--github-label-core-bg)] text-[var(--github-label-core-fg)]",
};

export function getGithubLabelColorClass(
	labelName: string,
): string | undefined {
	return githubLabelColorClassByName[labelName.toLowerCase()];
}
