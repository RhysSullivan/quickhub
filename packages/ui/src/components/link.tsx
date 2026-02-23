"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import {
	type RefCallback,
	useCallback,
	useRef,
	useSyncExternalStore,
} from "react";
import {
	type DiscoverBehavior,
	type PrefetchBehavior,
	Link as ReactRouterLink,
} from "react-router";
import {
	isQuickHubSpaNavigationEnabled,
	navigateQuickHubSpa,
} from "../lib/spa-navigation";
import { cn } from "../lib/utils";
import {
	type NavigationPrefetchParams,
	useNavigationPrefetch,
} from "./navigation-prefetch-provider";

function isExternalUrl(href: string): boolean {
	return href.startsWith("http://") || href.startsWith("https://");
}

function subscribeToPointer(onStoreChange: () => void) {
	const mql = window.matchMedia("(pointer: coarse)");
	mql.addEventListener("change", onStoreChange);
	return () => mql.removeEventListener("change", onStoreChange);
}

function getIsTouchDevice() {
	return window.matchMedia("(pointer: coarse)").matches;
}

function getServerSnapshot() {
	return false;
}

function useIsTouchDevice() {
	return useSyncExternalStore(
		subscribeToPointer,
		getIsTouchDevice,
		getServerSnapshot,
	);
}

function useViewportPrefetch(
	prefetch: () => void,
	enabled: boolean,
): RefCallback<HTMLAnchorElement> {
	const observerRef = useRef<IntersectionObserver | null>(null);

	return useCallback(
		(node: HTMLAnchorElement | null) => {
			if (observerRef.current) {
				observerRef.current.disconnect();
				observerRef.current = null;
			}

			if (!enabled || node === null) {
				return;
			}

			const observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) {
							prefetch();
							observer.disconnect();
							observerRef.current = null;
							break;
						}
					}
				},
				{ rootMargin: "200px" },
			);

			observer.observe(node);
			observerRef.current = observer;
		},
		[enabled, prefetch],
	);
}

function InternalLink({
	icon,
	className,
	prefetchKey,
	prefetchParams,
	...rest
}: React.ComponentPropsWithoutRef<typeof NextLink> & {
	href: string;
	icon?: React.ReactNode;
	prefetchKey?: string;
	prefetchParams?: NavigationPrefetchParams;
}) {
	const router = useRouter();
	const prefetchRequest = useNavigationPrefetch();
	const isTouch = useIsTouchDevice();
	const href = rest.href;
	const {
		children,
		prefetch: _nextPrefetch,
		scroll: _nextScroll,
		...routerSafeRest
	} = rest;
	const prefetched = useRef(false);
	const prefetchPromiseRef = useRef<Promise<void> | null>(null);
	const intent =
		prefetchKey === undefined
			? undefined
			: {
					key: prefetchKey,
					params: prefetchParams,
				};

	const triggerPrefetch = useCallback(() => {
		if (prefetchPromiseRef.current !== null) {
			return prefetchPromiseRef.current;
		}

		if (!prefetched.current) {
			prefetched.current = true;
			if (!isQuickHubSpaNavigationEnabled()) {
				router.prefetch(href);
			}
		}

		const prefetchPromise = Promise.resolve(
			prefetchRequest({ href, intent }),
		).catch(() => undefined);
		prefetchPromiseRef.current = prefetchPromise;
		return prefetchPromise;
	}, [href, intent, prefetchRequest, router]);

	const viewportRef = useViewportPrefetch(triggerPrefetch, isTouch);

	const handlePointerEnter = useCallback(
		(event: React.PointerEvent<HTMLAnchorElement>) => {
			rest.onPointerEnter?.(event);
			if (event.defaultPrevented) {
				return;
			}
			if (!isTouch) {
				triggerPrefetch();
			}
		},
		[isTouch, rest.onPointerEnter, triggerPrefetch],
	);

	const handleFocus = useCallback(
		(event: React.FocusEvent<HTMLAnchorElement>) => {
			rest.onFocus?.(event);
			if (event.defaultPrevented) {
				return;
			}
			triggerPrefetch();
		},
		[rest.onFocus, triggerPrefetch],
	);

	const handleMouseDown = useCallback(
		(event: React.MouseEvent<HTMLAnchorElement>) => {
			rest.onMouseDown?.(event);
			if (event.defaultPrevented) {
				return;
			}
			if (event.button !== 0) {
				return;
			}
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
				return;
			}

			triggerPrefetch();
		},
		[rest.onMouseDown, triggerPrefetch],
	);

	const handleClick = useCallback(
		(event: React.MouseEvent<HTMLAnchorElement>) => {
			rest.onClick?.(event);
			if (event.defaultPrevented) {
				return;
			}
			if (!isQuickHubSpaNavigationEnabled()) {
				return;
			}
			if (event.button !== 0) {
				return;
			}
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
				return;
			}

			event.preventDefault();
			const prefetchPromise = triggerPrefetch();
			const warmupWindow = new Promise<void>((resolve) => {
				setTimeout(resolve, 220);
			});

			void Promise.race([prefetchPromise, warmupWindow]).finally(() => {
				navigateQuickHubSpa(href);
			});
		},
		[href, rest.onClick, triggerPrefetch],
	);

	const sharedProps = {
		scroll: true,
		prefetch: false,
		...rest,
		onPointerEnter: handlePointerEnter,
		onFocus: handleFocus,
		onMouseDown: handleMouseDown,
		onClick: handleClick,
	};

	if (isQuickHubSpaNavigationEnabled()) {
		const discoverBehavior: DiscoverBehavior = "render";
		const prefetchBehavior: PrefetchBehavior = isTouch ? "viewport" : "intent";

		const routerLinkProps = {
			...routerSafeRest,
			to: href,
			discover: discoverBehavior,
			prefetch: prefetchBehavior,
			onPointerEnter: handlePointerEnter,
			onFocus: handleFocus,
			onMouseDown: handleMouseDown,
		};

		if (icon) {
			return (
				<ReactRouterLink
					{...routerLinkProps}
					className={cn("flex flex-row items-center gap-2", className)}
				>
					{icon}
					{children}
				</ReactRouterLink>
			);
		}

		return (
			<ReactRouterLink {...routerLinkProps} className={className}>
				{children}
			</ReactRouterLink>
		);
	}

	if (icon) {
		return (
			<NextLink
				{...sharedProps}
				ref={viewportRef}
				className={cn("flex flex-row items-center gap-2", className)}
			>
				{icon}
				{children}
			</NextLink>
		);
	}

	return (
		<NextLink {...sharedProps} ref={viewportRef} className={className}>
			{children}
		</NextLink>
	);
}

export function Link(
	props: React.ComponentPropsWithoutRef<typeof NextLink> & {
		href: string;
		icon?: React.ReactNode;
		prefetchKey?: string;
		prefetchParams?: NavigationPrefetchParams;
	},
) {
	const { icon, className, prefetchKey, prefetchParams, ...rest } = props;
	const isExternal = isExternalUrl(rest.href);

	if (isExternal) {
		if (icon) {
			return (
				<NextLink
					{...rest}
					href={rest.href}
					prefetch={false}
					scroll={true}
					target="_blank"
					rel="noopener noreferrer"
					className={cn("flex flex-row items-center gap-2", className)}
				>
					{props.icon}
					{props.children}
				</NextLink>
			);
		}

		return (
			<NextLink
				{...rest}
				href={rest.href}
				prefetch={false}
				scroll={true}
				target="_blank"
				rel="noopener noreferrer"
				className={className}
			>
				{props.children}
			</NextLink>
		);
	}

	return (
		<InternalLink
			icon={icon}
			className={className}
			prefetchKey={prefetchKey}
			prefetchParams={prefetchParams}
			{...rest}
		/>
	);
}
