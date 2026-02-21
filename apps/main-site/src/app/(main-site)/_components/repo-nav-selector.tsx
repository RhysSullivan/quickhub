"use client";

import { useSubscriptionWithInitial } from "@packages/confect/rpc";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@packages/ui/components/avatar";
import { Button } from "@packages/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@packages/ui/components/command";
import {
	Check,
	ChevronDown,
	ChevronUpIcon,
} from "@packages/ui/components/icons";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@packages/ui/components/popover";
import { cn } from "@packages/ui/lib/utils";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { Array as Arr, pipe, Record as Rec } from "effect";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SidebarRepo } from "../@sidebar/sidebar-client";

const EmptyPayload: Record<string, never> = {};

export function RepoNavSelector({
	owner,
	name,
	activeTab,
	initialRepos,
}: {
	owner: string;
	name: string;
	activeTab: string;
	initialRepos: ReadonlyArray<SidebarRepo>;
}) {
	const router = useRouter();
	const client = useProjectionQueries();
	const reposAtom = useMemo(
		() => client.listRepos.subscription(EmptyPayload),
		[client],
	);
	const repos = useSubscriptionWithInitial(reposAtom, initialRepos);

	const grouped = useMemo(
		() =>
			pipe(
				repos,
				Arr.groupBy((repo) => repo.ownerLogin),
			),
		[repos],
	);

	const owners = useMemo(() => Rec.keys(grouped), [grouped]);
	const ownerRepos = useMemo(() => grouped[owner] ?? [], [grouped, owner]);
	const currentOwnerAvatar = useMemo(
		() => ownerRepos[0]?.ownerAvatarUrl ?? null,
		[ownerRepos],
	);

	const [orgOpen, setOrgOpen] = useState(false);
	const [repoOpen, setRepoOpen] = useState(false);

	return (
		<div className="flex flex-col gap-1.5 px-2 pt-2.5 pb-1.5">
			{/* Row 1: Org selector */}
			<Popover open={orgOpen} onOpenChange={setOrgOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="h-8 w-full justify-between px-2 gap-1.5 text-xs font-bold tracking-tight"
					>
						<span className="flex items-center gap-2 min-w-0">
							<Avatar className="size-5 shrink-0">
								{currentOwnerAvatar && (
									<AvatarImage src={currentOwnerAvatar} alt={owner} />
								)}
								<AvatarFallback className="text-[8px]">
									{owner.slice(0, 2).toUpperCase()}
								</AvatarFallback>
							</Avatar>
							<span className="truncate">{owner}</span>
						</span>
						{orgOpen ? (
							<ChevronUpIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
						) : (
							<ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50" />
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-52 p-0" align="start" sideOffset={6}>
					<Command>
						<CommandInput
							placeholder="Search orgs..."
							className="h-8 text-xs"
						/>
						<CommandList>
							<CommandEmpty className="py-4 text-xs">
								No orgs found.
							</CommandEmpty>
							<CommandGroup>
								{owners.map((org) => {
									const orgRepos = grouped[org] ?? [];
									const avatarUrl = orgRepos[0]?.ownerAvatarUrl ?? null;
									return (
										<CommandItem
											key={org}
											value={org}
											className="gap-2 text-xs py-1.5"
											onSelect={() => {
												if (org !== owner) {
													const firstRepo = orgRepos[0];
													if (firstRepo) {
														router.push(
															`/${org}/${firstRepo.name}/${activeTab}`,
														);
													}
												}
												setOrgOpen(false);
											}}
										>
											<Avatar className="size-5 shrink-0">
												{avatarUrl && <AvatarImage src={avatarUrl} alt={org} />}
												<AvatarFallback className="text-[8px]">
													{org.slice(0, 2).toUpperCase()}
												</AvatarFallback>
											</Avatar>
											<span className="truncate">{org}</span>
											<Check
												className={cn(
													"ml-auto size-3.5",
													org === owner ? "opacity-100" : "opacity-0",
												)}
											/>
										</CommandItem>
									);
								})}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>

			{/* Row 2: Repo selector */}
			<Popover open={repoOpen} onOpenChange={setRepoOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="h-8 w-full justify-between px-2 gap-1.5 text-xs font-bold tracking-tight"
					>
						<span className="truncate">{name}</span>
						{repoOpen ? (
							<ChevronUpIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
						) : (
							<ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50" />
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-52 p-0" align="start" sideOffset={6}>
					<Command>
						<CommandInput
							placeholder="Search repos..."
							className="h-7 text-[11px]"
						/>
						<CommandList>
							<CommandEmpty className="py-3 text-[11px]">
								No repos found.
							</CommandEmpty>
							<CommandGroup>
								{ownerRepos.map((repo) => (
									<CommandItem
										key={repo.repositoryId}
										value={repo.name}
										className="gap-1.5 text-[11px] py-1"
										onSelect={() => {
											if (repo.name !== name) {
												router.push(`/${owner}/${repo.name}/${activeTab}`);
											}
											setRepoOpen(false);
										}}
									>
										<span className="truncate">{repo.name}</span>
										{(repo.openPrCount > 0 || repo.failingCheckCount > 0) && (
											<span className="ml-auto shrink-0 text-[9px] text-muted-foreground/40 tabular-nums flex items-center gap-1">
												{repo.openPrCount > 0 && (
													<span>{repo.openPrCount} PRs</span>
												)}
												{repo.failingCheckCount > 0 && (
													<span className="text-red-500/60">
														{repo.failingCheckCount} failing
													</span>
												)}
											</span>
										)}
										<Check
											className={cn(
												"shrink-0 size-3",
												repo.name === name ? "opacity-100" : "opacity-0",
											)}
										/>
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
