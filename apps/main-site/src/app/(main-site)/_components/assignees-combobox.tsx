"use client";

import { Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@packages/ui/components/command";
import { Check, ChevronsUpDown, Users, X } from "@packages/ui/components/icons";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@packages/ui/components/popover";
import { cn } from "@packages/ui/lib/utils";
import { useGithubActions } from "@packages/ui/rpc/github-actions";
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { Option } from "effect";
import { useId, useMemo, useState } from "react";

type Assignee = {
	readonly login: string;
	readonly avatarUrl: string | null;
};

export function AssigneesCombobox({
	ownerLogin,
	name,
	repositoryId,
	number,
	currentAssignees,
	optimisticOperationType,
	optimisticState,
	optimisticErrorMessage,
}: {
	ownerLogin: string;
	name: string;
	repositoryId: number;
	number: number;
	currentAssignees: readonly Assignee[];
	optimisticOperationType?: string | null;
	optimisticState?: "pending" | "failed" | "confirmed" | null;
	optimisticErrorMessage?: string | null;
}) {
	const [open, setOpen] = useState(false);

	const client = useProjectionQueries();
	const assigneesAtom = useMemo(
		() => client.listRepoAssignees.subscription({ ownerLogin, name }),
		[client, ownerLogin, name],
	);
	const assigneesResult = useAtomValue(assigneesAtom);
	const githubActions = useGithubActions();
	const [searchQuery, setSearchQuery] = useState("");
	const normalizedSearchQuery = searchQuery.trim();
	const remoteAssigneesAtom = useMemo(
		() =>
			githubActions.listRepoAssignees.callAsQuery({
				ownerLogin,
				name,
				query:
					normalizedSearchQuery.length > 0 ? normalizedSearchQuery : undefined,
			}),
		[githubActions, ownerLogin, name, normalizedSearchQuery],
	);
	const remoteAssigneesResult = useAtomValue(remoteAssigneesAtom);
	const isLoadingRemoteAssignees = Result.isWaiting(remoteAssigneesResult);

	const writeClient = useGithubWrite();
	const [updateResult, updateAssignees] = useAtom(
		writeClient.updateAssignees.call,
	);
	const correlationPrefix = useId();
	const isUpdating = Result.isWaiting(updateResult);

	// Merge server-known assignees with current issue assignees
	const availableAssignees = useMemo(() => {
		const merged = new Map<string, Assignee>();

		if (Result.isSuccess(assigneesResult)) {
			const valueOpt = Result.value(assigneesResult);
			if (Option.isSome(valueOpt)) {
				for (const a of valueOpt.value) {
					merged.set(a.login, a);
				}
			}
		}

		if (Result.isSuccess(remoteAssigneesResult)) {
			const valueOpt = Result.value(remoteAssigneesResult);
			if (Option.isSome(valueOpt)) {
				for (const a of valueOpt.value) {
					merged.set(a.login, a);
				}
			}
		}

		// Ensure current assignees are always present
		for (const a of currentAssignees) {
			if (!merged.has(a.login)) {
				merged.set(a.login, a);
			}
		}

		return [...merged.values()];
	}, [assigneesResult, remoteAssigneesResult, currentAssignees]);

	const currentLogins = new Set(currentAssignees.map((a) => a.login));

	const handleToggle = (login: string) => {
		if (currentLogins.has(login)) {
			updateAssignees({
				correlationId: `${correlationPrefix}-remove-assignee-${Date.now()}`,
				ownerLogin,
				name,
				repositoryId,
				number,
				assigneesToAdd: [],
				assigneesToRemove: [login],
			});
		} else {
			updateAssignees({
				correlationId: `${correlationPrefix}-add-assignee-${Date.now()}`,
				ownerLogin,
				name,
				repositoryId,
				number,
				assigneesToAdd: [login],
				assigneesToRemove: [],
			});
		}
	};

	const handleRemove = (login: string) => {
		updateAssignees({
			correlationId: `${correlationPrefix}-remove-assignee-${Date.now()}`,
			ownerLogin,
			name,
			repositoryId,
			number,
			assigneesToAdd: [],
			assigneesToRemove: [login],
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
							<Users className="size-3" />
							Assignees
						</span>
						<ChevronsUpDown className="size-3 opacity-50" />
					</button>
				</PopoverTrigger>
				<PopoverContent className="w-56 p-0" align="start">
					<Command>
						<CommandInput
							placeholder="Search GitHub users..."
							value={searchQuery}
							onValueChange={setSearchQuery}
						/>
						<CommandList>
							<CommandEmpty>No users found.</CommandEmpty>
							<CommandGroup>
								{availableAssignees.map((assignee) => (
									<CommandItem
										key={assignee.login}
										value={assignee.login}
										onSelect={() => handleToggle(assignee.login)}
									>
										<Avatar className="size-4 mr-1.5">
											<AvatarImage src={assignee.avatarUrl ?? undefined} />
											<AvatarFallback className="text-[7px]">
												{assignee.login[0]?.toUpperCase()}
											</AvatarFallback>
										</Avatar>
										<span className="text-xs truncate flex-1">
											{assignee.login}
										</span>
										{currentLogins.has(assignee.login) && (
											<Check className="size-3.5 text-primary" />
										)}
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
						{isLoadingRemoteAssignees && (
							<p className="px-2 pb-2 text-[10px] text-muted-foreground">
								Loading users from GitHub...
							</p>
						)}
						{Result.isFailure(remoteAssigneesResult) && (
							<p className="px-2 pb-2 text-[10px] text-muted-foreground">
								Could not load additional users from GitHub.
							</p>
						)}
					</Command>
				</PopoverContent>
			</Popover>

			{/* Display current assignees */}
			{currentAssignees.length > 0 ? (
				<div className="mt-1.5 space-y-1">
					{currentAssignees.map((assignee) => (
						<div
							key={assignee.login}
							className="flex items-center gap-1.5 group"
						>
							<Avatar className="size-4">
								<AvatarImage src={assignee.avatarUrl ?? undefined} />
								<AvatarFallback className="text-[7px]">
									{assignee.login[0]?.toUpperCase()}
								</AvatarFallback>
							</Avatar>
							<span className="text-xs text-muted-foreground flex-1 truncate">
								{assignee.login}
							</span>
							<button
								type="button"
								onClick={() => handleRemove(assignee.login)}
								className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity cursor-pointer"
							>
								<X className="size-3" />
							</button>
						</div>
					))}
				</div>
			) : (
				<p className="mt-1 text-[11px] text-muted-foreground/50">
					No one assigned
				</p>
			)}

			{Result.isFailure(updateResult) && (
				<p className="mt-1 text-xs text-destructive">
					Could not queue assignee update.
				</p>
			)}
			{optimisticOperationType === "update_assignees" &&
				optimisticState === "pending" && (
					<p className="mt-1 text-xs text-muted-foreground">
						Syncing with GitHub...
					</p>
				)}
			{optimisticOperationType === "update_assignees" &&
				optimisticState === "failed" && (
					<p className="mt-1 text-xs text-destructive">
						{optimisticErrorMessage ?? "GitHub rejected this assignee update."}
					</p>
				)}
		</div>
	);
}
