"use client";
import NextLink from "next/link";
import type React from "react";
import { cn } from "../lib/utils";

function isExternalUrl(href: string): boolean {
	return href.startsWith("http://") || href.startsWith("https://");
}

export function Link(
	props: React.ComponentPropsWithoutRef<typeof NextLink> & {
		href: string;
		icon?: React.ReactNode;
	},
) {
	const { icon, className, ...rest } = props;
	const isExternal = isExternalUrl(rest.href);

	if (isExternal) {
		const { prefetch, replace, scroll, shallow, passHref, ...anchorProps } =
			rest;
		if (icon) {
			return (
				<a
					{...anchorProps}
					href={rest.href}
					target="_blank"
					rel="noopener noreferrer"
					className={cn("flex flex-row items-center gap-2", className)}
				>
					{props.icon}
					{props.children}
				</a>
			);
		}
		return (
			<a
				{...anchorProps}
				href={rest.href}
				target="_blank"
				rel="noopener noreferrer"
				className={className}
			>
				{props.children}
			</a>
		);
	}

	if (icon)
		return (
			<NextLink
				scroll={true}
				prefetch={false}
				{...rest}
				className={cn("flex flex-row items-center gap-2", className)}
			>
				{props.icon}
				{props.children}
			</NextLink>
		);
	return <NextLink scroll={true} prefetch={false} {...props} />;
}
