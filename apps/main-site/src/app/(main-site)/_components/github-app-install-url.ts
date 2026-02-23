export function buildGitHubAppInstallUrl(
	baseInstallUrl: string,
	returnPath: string,
) {
	const installUrl = new URL(baseInstallUrl);
	installUrl.searchParams.set("state", returnPath);
	return installUrl.toString();
}
