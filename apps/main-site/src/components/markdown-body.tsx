"use client";

import {
	Children,
	type ComponentProps,
	type HTMLAttributes,
	isValidElement,
	type ReactNode,
} from "react";
import { type Components, type ExtraProps, Streamdown } from "streamdown";

/**
 * Checks if any React children contain block-level elements (like divs from
 * streamdown's image wrapper). If so, the paragraph must render as a <div>
 * instead of <p> to avoid invalid HTML nesting.
 *
 * Streamdown's image component is a React function component (not a native
 * "div"), so we also inspect the `node` prop that streamdown attaches to
 * each component child — when `node.tagName` is "img", the image component
 * will render a wrapper `<div>`, which is invalid inside `<p>`.
 */
function hasBlockChild(children: ReactNode): boolean {
	let found = false;
	Children.forEach(children, (child) => {
		if (found) return;
		if (
			isValidElement<{ node?: { tagName?: string }; children?: ReactNode }>(
				child,
			)
		) {
			// Native block-level elements
			if (child.type === "div") {
				found = true;
				return;
			}
			// Streamdown passes a `node` prop with the hast tagName.
			// The img component renders a <div data-streamdown="image-wrapper">,
			// so it's a block-level child even though the React element type is
			// a function component rather than "div".
			if (child.props.node?.tagName === "img") {
				found = true;
				return;
			}
			// Recurse into fragments / wrappers
			if (child.props.children) {
				if (hasBlockChild(child.props.children)) {
					found = true;
				}
			}
		}
	});
	return found;
}

/**
 * Custom paragraph component that renders as <div> when it contains block-level
 * children (e.g. streamdown's image wrapper divs), preventing the browser
 * hydration error "<p> cannot contain a nested <div>".
 */
function SafeParagraph({
	children,
	node: _node,
	...rest
}: HTMLAttributes<HTMLParagraphElement> & ExtraProps) {
	if (hasBlockChild(children)) {
		return <div {...rest}>{children}</div>;
	}
	return <p {...rest}>{children}</p>;
}

const safeComponents: Components = {
	p: SafeParagraph,
};

/**
 * Thin wrapper around <Streamdown> that fixes the `<p>` containing `<div>`
 * hydration error caused by streamdown's image wrapper.
 */
export function MarkdownBody(
	props: Omit<ComponentProps<typeof Streamdown>, "components"> & {
		components?: Components;
	},
) {
	const { components: userComponents, ...rest } = props;
	const merged: Components = userComponents
		? { ...safeComponents, ...userComponents }
		: safeComponents;
	return (
		<Streamdown {...rest} components={merged} linkSafety={{ enabled: true }} />
	);
}
