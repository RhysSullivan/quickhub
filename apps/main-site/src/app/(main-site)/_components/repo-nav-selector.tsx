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

/**
 * Org + Repo picker used across the entire app.
 *
 * - Selecting an org navigates to /:org
 * - Selecting a repo navigates to /:org/:repo
 * - `owner`/`name` are null when on the homepage (nothing selected).
 */
export function RepoNavSelector({
	owner,
	name,
	activeTab,
	initialRepos,
}: {
	owner: string | null;
	name: string | null;
	activeTab?: string;
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
	const ownerRepos = useMemo(
		() => (owner !== null ? (grouped[owner] ?? []) : [...repos]),
		[grouped, owner, repos],
	);
	const currentOwnerAvatar = useMemo(() => {
		if (owner === null) return null;
		return (grouped[owner] ?? [])[0]?.ownerAvatarUrl ?? null;
	}, [grouped, owner]);
	const currentRepoAvatar = useMemo(() => {
		if (name === null) return null;
		const selectedRepo = repos.find(
			(repo) => repo.ownerLogin === owner && repo.name === name,
		);
		if (selectedRepo) return selectedRepo.ownerAvatarUrl;
		const fallbackRepo = repos.find((repo) => repo.name === name);
		return fallbackRepo?.ownerAvatarUrl ?? null;
	}, [name, owner, repos]);

	const [orgOpen, setOrgOpen] = useState(false);
	const [repoOpen, setRepoOpen] = useState(false);

	const handleOwnerSelect = (org: string) => {
		if (org !== owner) {
			router.push(`/${org}`);
		}
		setOrgOpen(false);
	};

	const handleAllOrgSelect = () => {
		router.push("/");
		setOrgOpen(false);
	};

	const handleRepoSelect = (repo: SidebarRepo) => {
		if (repo.ownerLogin !== owner || repo.name !== name) {
			if (activeTab) {
				router.push(`/${repo.ownerLogin}/${repo.name}/${activeTab}`);
			} else {
				router.push(`/${repo.ownerLogin}/${repo.name}`);
			}
		}
		setRepoOpen(false);
	};

	const handleAllRepoSelect = () => {
		if (owner !== null) {
			router.push(`/${owner}`);
		} else {
			router.push("/");
		}
		setRepoOpen(false);
	};

	const ownerLabel = owner ?? "All Orgs";
	const repoLabel = name ?? "All Repos";

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
							{owner !== null && (
								<Avatar className="size-5 shrink-0">
									{currentOwnerAvatar && (
										<AvatarImage src={currentOwnerAvatar} alt={owner} />
									)}
									<AvatarFallback className="text-[8px]">
										{owner.slice(0, 2).toUpperCase()}
									</AvatarFallback>
								</Avatar>
							)}
							<span className="truncate">{ownerLabel}</span>
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
						<CommandList>
							<CommandEmpty className="py-4 text-xs">
								No orgs found.
							</CommandEmpty>
							<CommandGroup>
								<CommandItem
									value="__all_orgs__"
									className="gap-2 text-xs py-1.5"
									onSelect={handleAllOrgSelect}
								>
									<span className="truncate">All Orgs</span>
									<Check
										className={cn(
											"ml-auto size-3.5",
											owner === null ? "opacity-100" : "opacity-0",
										)}
									/>
								</CommandItem>
								{owners.map((org) => {
									const orgRepos = grouped[org] ?? [];
									const avatarUrl = orgRepos[0]?.ownerAvatarUrl ?? null;
									return (
										<CommandItem
											key={org}
											value={org}
											className="gap-2 text-xs py-1.5"
											onSelect={() => handleOwnerSelect(org)}
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
						<span className="flex items-center gap-2 min-w-0">
							{name !== null && (
								<Avatar className="size-5 shrink-0">
									{currentRepoAvatar && (
										<AvatarImage src={currentRepoAvatar} alt={name} />
									)}
									<AvatarFallback className="text-[8px]">
										{name.slice(0, 2).toUpperCase()}
									</AvatarFallback>
								</Avatar>
							)}
							<span className="truncate">{repoLabel}</span>
						</span>
						{repoOpen ? (
							<ChevronUpIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
						) : (
							<ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50" />
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-56 p-0" align="start" sideOffset={6}>
					<Command>
						<CommandList>
							<CommandEmpty className="py-4 text-xs">
								No repos found.
							</CommandEmpty>
							<CommandGroup>
								<CommandItem
									value="__all_repos__"
									className="gap-2 text-xs py-1.5"
									onSelect={handleAllRepoSelect}
								>
									<span className="truncate">All Repos</span>
									<Check
										className={cn(
											"shrink-0 size-3.5",
											name === null ? "opacity-100" : "opacity-0",
										)}
									/>
								</CommandItem>
								{ownerRepos.map((repo) => (
									<CommandItem
										key={repo.repositoryId}
										value={repo.name}
										className="gap-2 text-xs py-1.5"
										onSelect={() => handleRepoSelect(repo)}
									>
										<Avatar className="size-5 shrink-0">
											{repo.ownerAvatarUrl && (
												<AvatarImage
													src={repo.ownerAvatarUrl}
													alt={repo.name}
												/>
											)}
											<AvatarFallback className="text-[8px]">
												{repo.name.slice(0, 2).toUpperCase()}
											</AvatarFallback>
										</Avatar>
										<span className="truncate">{repo.name}</span>
										{(repo.openPrCount > 0 || repo.failingCheckCount > 0) && (
											<span className="ml-auto shrink-0 text-[10px] text-muted-foreground/40 tabular-nums flex items-center gap-1">
												{repo.openPrCount > 0 && (
													<span>{repo.openPrCount} PRs</span>
												)}
												{repo.failingCheckCount > 0 && (
													<span className="text-status-closed/60">
														{repo.failingCheckCount} failing
													</span>
												)}
											</span>
										)}
										<Check
											className={cn(
												"shrink-0 size-3.5",
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
