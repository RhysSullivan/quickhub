"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@packages/ui/components/dialog";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useState } from "react";

const PR_LIST_SHORTCUTS = [
	{ keys: ["j"], description: "Open next pull request" },
	{ keys: ["k"], description: "Open previous pull request" },
	{ keys: ["o"], description: "Open current pull request" },
] as const;

const GLOBAL_SHORTCUTS = [
	{ keys: ["?"], description: "Show keyboard shortcuts" },
] as const;

function Kbd({ children }: { children: string }) {
	return (
		<kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded border border-border bg-muted text-xs font-mono font-medium text-muted-foreground shadow-[0_1px_0_1px_rgba(0,0,0,0.04)]">
			{children}
		</kbd>
	);
}

function ShortcutRow({
	keys,
	description,
}: {
	keys: readonly string[];
	description: string;
}) {
	return (
		<div className="flex items-center justify-between py-1.5">
			<span className="text-sm text-foreground">{description}</span>
			<div className="flex items-center gap-1">
				{keys.map((key) => (
					<Kbd key={key}>{key}</Kbd>
				))}
			</div>
		</div>
	);
}

function ShortcutSection({
	title,
	shortcuts,
}: {
	title: string;
	shortcuts: ReadonlyArray<{
		readonly keys: readonly string[];
		readonly description: string;
	}>;
}) {
	return (
		<div>
			<h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1">
				{title}
			</h3>
			<div className="divide-y divide-border/50">
				{shortcuts.map((shortcut) => (
					<ShortcutRow
						key={shortcut.description}
						keys={shortcut.keys}
						description={shortcut.description}
					/>
				))}
			</div>
		</div>
	);
}

export function KeyboardShortcutsDialog() {
	const [open, setOpen] = useState(false);

	useHotkey({ key: "/", shift: true }, () => {
		setOpen((prev) => !prev);
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Keyboard Shortcuts</DialogTitle>
					<DialogDescription>
						Navigate quickly with these keyboard shortcuts.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<ShortcutSection
						title="Pull Request List"
						shortcuts={PR_LIST_SHORTCUTS}
					/>
					<ShortcutSection title="Global" shortcuts={GLOBAL_SHORTCUTS} />
				</div>
			</DialogContent>
		</Dialog>
	);
}
