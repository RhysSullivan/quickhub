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
import { cn } from "../lib/utils";

const POINTER_PREFETCH_RADIUS_PX = 320;
const POINTER_PREFETCH_MAX_LINKS_PER_FRAME = 3;

type PointerPrefetchEntry = {
	href: string;
	prefetch: () => void;
};

const prefetchedHrefs = new Set<string>();
const pointerPrefetchEntries = new Map<
	HTMLAnchorElement,
	PointerPrefetchEntry
>();

let pointerMoveListenerController: AbortController | null = null;
let pointerX = 0;
let pointerY = 0;
let pointerFrameScheduled = false;

function distanceToRectSquared(x: number, y: number, rect: DOMRect): number {
	const distanceX =
		x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
	const distanceY =
		y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
	return distanceX * distanceX + distanceY * distanceY;
}

function stopPointerListenerWhenUnused() {
	if (pointerPrefetchEntries.size > 0 || !pointerMoveListenerController) {
		return;
	}

	pointerMoveListenerController.abort();
	pointerMoveListenerController = null;
}

function prefetchNearbyLinks() {
	if (pointerPrefetchEntries.size === 0) {
		stopPointerListenerWhenUnused();
		return;
	}

	const radiusSquared = POINTER_PREFETCH_RADIUS_PX * POINTER_PREFETCH_RADIUS_PX;
	const candidateLinks: Array<{
		entry: PointerPrefetchEntry;
		distance: number;
	}> = [];

	for (const [element, entry] of pointerPrefetchEntries) {
		if (!element.isConnected) {
			pointerPrefetchEntries.delete(element);
			continue;
		}

		if (prefetchedHrefs.has(entry.href)) {
			continue;
		}

		const rect = element.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) {
			continue;
		}

		const distance = distanceToRectSquared(pointerX, pointerY, rect);
		if (distance <= radiusSquared) {
			candidateLinks.push({ entry, distance });
		}
	}

	candidateLinks
		.sort((left, right) => left.distance - right.distance)
		.slice(0, POINTER_PREFETCH_MAX_LINKS_PER_FRAME)
		.forEach(({ entry }) => {
			entry.prefetch();
		});

	stopPointerListenerWhenUnused();
}

function queuePointerPrefetch() {
	if (pointerFrameScheduled) {
		return;
	}

	pointerFrameScheduled = true;
	window.requestAnimationFrame(() => {
		pointerFrameScheduled = false;
		prefetchNearbyLinks();
	});
}

function onGlobalPointerMove(event: PointerEvent) {
	if (event.pointerType !== "mouse") {
		return;
	}

	pointerX = event.clientX;
	pointerY = event.clientY;
	queuePointerPrefetch();
}

function ensurePointerListener() {
	if (pointerMoveListenerController || typeof window === "undefined") {
		return;
	}

	const controller = new AbortController();
	pointerMoveListenerController = controller;
	window.addEventListener("pointermove", onGlobalPointerMove, {
		passive: true,
		signal: controller.signal,
	});
}

function registerPointerPrefetchLink(
	element: HTMLAnchorElement,
	entry: PointerPrefetchEntry,
) {
	pointerPrefetchEntries.set(element, entry);
	ensurePointerListener();
}

function unregisterPointerPrefetchLink(element: HTMLAnchorElement) {
	pointerPrefetchEntries.delete(element);
	stopPointerListenerWhenUnused();
}

function isExternalUrl(href: string): boolean {
	return href.startsWith("http://") || href.startsWith("https://");
}

/**
 * Detects if the device has a coarse pointer (touch screen).
 * Uses useSyncExternalStore so all Link instances share one subscription
 * instead of each running their own useState + useEffect.
 */
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

function usePointerRadiusPrefetch(
	href: string,
	enabled: boolean,
	prefetch: () => void,
): RefCallback<HTMLAnchorElement> {
	const registeredNodeRef = useRef<HTMLAnchorElement | null>(null);

	return useCallback(
		(node: HTMLAnchorElement | null) => {
			const registeredNode = registeredNodeRef.current;

			if (registeredNode && registeredNode !== node) {
				unregisterPointerPrefetchLink(registeredNode);
				registeredNodeRef.current = null;
			}

			if (!enabled || !node) {
				if (registeredNode) {
					unregisterPointerPrefetchLink(registeredNode);
					registeredNodeRef.current = null;
				}
				return;
			}

			registerPointerPrefetchLink(node, { href, prefetch });
			registeredNodeRef.current = node;
		},
		[enabled, href, prefetch],
	);
}

/**
 * On touch devices, prefetch links when they enter the viewport.
 * Returns a ref callback to attach to the link element.
 */
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

			if (!enabled || !node) {
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
	...rest
}: React.ComponentPropsWithoutRef<typeof NextLink> & {
	href: string;
	icon?: React.ReactNode;
}) {
	const router = useRouter();
	const isTouch = useIsTouchDevice();
	const href = rest.href;
	const {
		onMouseDown: onMouseDownProp,
		onPointerEnter: onPointerEnterProp,
		scroll,
		...linkProps
	} = rest;

	const prefetchRoute = useCallback(() => {
		if (prefetchedHrefs.has(href)) {
			return;
		}

		prefetchedHrefs.add(href);
		router.prefetch(href);
	}, [href, router]);

	const viewportRef = useViewportPrefetch(prefetchRoute, isTouch);
	const pointerRadiusRef = usePointerRadiusPrefetch(
		href,
		!isTouch,
		prefetchRoute,
	);

	const linkRef = useCallback(
		(node: HTMLAnchorElement | null) => {
			viewportRef(node);
			pointerRadiusRef(node);
		},
		[viewportRef, pointerRadiusRef],
	);

	const prefetchOnPointerEnter = useCallback(
		(event: React.PointerEvent<HTMLAnchorElement>) => {
			onPointerEnterProp?.(event);
			if (event.defaultPrevented || isTouch) {
				return;
			}

			prefetchRoute();
		},
		[isTouch, onPointerEnterProp, prefetchRoute],
	);

	const navigateOnMouseDown = useCallback(
		(event: React.MouseEvent<HTMLAnchorElement>) => {
			onMouseDownProp?.(event);
			if (event.defaultPrevented) {
				return;
			}

			if (event.button !== 0) {
				return;
			}

			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
				return;
			}

			event.preventDefault();
			router.push(href, { scroll: scroll ?? true });
		},
		[href, onMouseDownProp, router, scroll],
	);

	const sharedProps = {
		...linkProps,
		href,
		scroll: scroll ?? true,
		prefetch: false,
		onPointerEnter: prefetchOnPointerEnter,
		onMouseDown: navigateOnMouseDown,
	};

	if (icon) {
		return (
			<NextLink
				{...sharedProps}
				ref={linkRef}
				className={cn("flex flex-row items-center gap-2", className)}
			>
				{icon}
				{rest.children}
			</NextLink>
		);
	}

	return (
		<NextLink {...sharedProps} ref={linkRef} className={className}>
			{rest.children}
		</NextLink>
	);
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
		<InternalLink icon={icon} className={className} prefetch={true} {...rest} />
	);
}
