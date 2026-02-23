"use client";

import { Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { Badge } from "@packages/ui/components/badge";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@packages/ui/components/command";
import { Check, ChevronsUpDown, Tag, X } from "@packages/ui/components/icons";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@packages/ui/components/popover";
import { cn } from "@packages/ui/lib/utils";
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { Option } from "effect";
import { useId, useMemo, useState } from "react";

export function LabelsCombobox({
	ownerLogin,
	name,
	repositoryId,
	number,
	currentLabels,
	optimisticOperationType,
	optimisticState,
	optimisticErrorMessage,
}: {
	ownerLogin: string;
	name: string;
	repositoryId: number;
	number: number;
	currentLabels: readonly string[];
	optimisticOperationType?: string | null;
	optimisticState?: "pending" | "failed" | "confirmed" | null;
	optimisticErrorMessage?: string | null;
}) {
	const [open, setOpen] = useState(false);

	const client = useProjectionQueries();
	const labelsAtom = useMemo(
		() => client.listRepoLabels.subscription({ ownerLogin, name }),
		[client, ownerLogin, name],
	);
	const labelsResult = useAtomValue(labelsAtom);

	const writeClient = useGithubWrite();
	const [updateResult, updateLabels] = useAtom(writeClient.updateLabels.call);
	const correlationPrefix = useId();
	const isUpdating = Result.isWaiting(updateResult);

	// Merge server-known labels with current issue labels
	const availableLabels = useMemo(() => {
		if (!Result.isSuccess(labelsResult)) return [...currentLabels];
		const valueOpt = Result.value(labelsResult);
		if (Option.isNone(valueOpt)) return [...currentLabels];

		const serverLabels = valueOpt.value;
		const labelSet = new Set(serverLabels);
		// Include current labels that aren't in the server list
		const extra = currentLabels.filter((l) => !labelSet.has(l));
		return [...serverLabels, ...extra];
	}, [labelsResult, currentLabels]);

	const currentLabelSet = new Set(currentLabels);

	const handleToggle = (label: string) => {
		if (currentLabelSet.has(label)) {
			updateLabels({
				correlationId: `${correlationPrefix}-remove-label-${Date.now()}`,
				ownerLogin,
				name,
				repositoryId,
				number,
				labelsToAdd: [],
				labelsToRemove: [label],
			});
		} else {
			updateLabels({
				correlationId: `${correlationPrefix}-add-label-${Date.now()}`,
				ownerLogin,
				name,
				repositoryId,
				number,
				labelsToAdd: [label],
				labelsToRemove: [],
			});
		}
	};

	const handleRemove = (label: string) => {
		updateLabels({
			correlationId: `${correlationPrefix}-remove-label-${Date.now()}`,
			ownerLogin,
			name,
			repositoryId,
			number,
			labelsToAdd: [],
			labelsToRemove: [label],
		});
	};

	return (
		<div>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-expanded={open}
						className={cn(
							"flex w-full items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer",
							isUpdating && "opacity-50",
						)}
					>
						<span className="inline-flex items-center gap-1">
							<Tag className="size-3" />
							Labels
						</span>
						<ChevronsUpDown className="size-3 opacity-50" />
					</button>
				</PopoverTrigger>
				<PopoverContent className="w-56 p-0" align="start">
					<Command>
						<CommandInput placeholder="Search labels..." />
						<CommandList>
							<CommandEmpty>No labels found.</CommandEmpty>
							<CommandGroup>
								{availableLabels.map((label) => (
									<CommandItem
										key={label}
										value={label}
										onSelect={() => handleToggle(label)}
									>
										<span className="text-xs truncate flex-1">{label}</span>
										{currentLabelSet.has(label) && (
											<Check className="size-3.5 text-primary" />
										)}
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>

			{/* Display current labels */}
			{currentLabels.length > 0 ? (
				<div className="mt-1.5 flex flex-wrap gap-1">
					{currentLabels.map((label) => (
						<Badge
							key={label}
							variant="secondary"
							className="text-[10px] gap-1 group"
						>
							{label}
							<button
								type="button"
								onClick={() => handleRemove(label)}
								className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity cursor-pointer"
							>
								<X className="size-2.5" />
							</button>
						</Badge>
					))}
				</div>
			) : (
				<p className="mt-1 text-[11px] text-muted-foreground/50">None yet</p>
			)}

			{Result.isFailure(updateResult) && (
				<p className="mt-1 text-xs text-destructive">
					Could not queue label update.
				</p>
			)}
			{optimisticOperationType === "update_labels" &&
				optimisticState === "pending" && (
					<p className="mt-1 text-xs text-muted-foreground">
						Syncing with GitHub...
					</p>
				)}
			{optimisticOperationType === "update_labels" &&
				optimisticState === "failed" && (
					<p className="mt-1 text-xs text-destructive">
						{optimisticErrorMessage ?? "GitHub rejected this label update."}
					</p>
				)}
		</div>
	);
}
