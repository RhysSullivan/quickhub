"use client";

import { Button } from "@packages/ui/components/button";
import { Download } from "@packages/ui/components/icons";
import { useEffect, useState, type ComponentProps } from "react";
import { buildGitHubAppInstallUrl } from "./github-app-install-url";

const GITHUB_APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "";
const GITHUB_APP_INSTALL_URL = GITHUB_APP_SLUG
	? `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`
	: "";

type InstallGitHubAppButtonProps = Omit<
	ComponentProps<typeof Button>,
	"asChild"
> & {
	iconClassName?: string;
	hideIcon?: boolean;
};

export function InstallGitHubAppButton({
	iconClassName = "size-4",
	hideIcon = false,
	children,
	...buttonProps
}: InstallGitHubAppButtonProps) {
	if (!GITHUB_APP_INSTALL_URL) {
		return null;
	}

	const [installHref, setInstallHref] = useState(GITHUB_APP_INSTALL_URL);

	useEffect(() => {
		const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		setInstallHref(buildGitHubAppInstallUrl(GITHUB_APP_INSTALL_URL, returnPath));
	}, []);

	return (
		<Button asChild {...buttonProps}>
			<a
				href={installHref}
				onClick={(event) => {
					const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
					event.currentTarget.href = buildGitHubAppInstallUrl(
						GITHUB_APP_INSTALL_URL,
						returnPath,
					);
				}}
			>
				{!hideIcon && <Download className={iconClassName} />}
				{children ?? "Install GitHub App"}
			</a>
		</Button>
	);
}
