"use client";

import { LogOut } from "@packages/ui/components/icons";
import { GitHubIcon } from "@packages/ui/icons/index";
import { authClient } from "@packages/ui/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { Button } from "./button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./dropdown-menu";

function getInitials(name: string) {
	return name
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}

export function UserButton() {
	const session = authClient.useSession();

	if (session.isPending) {
		return <div className="size-7 animate-pulse rounded-full bg-muted" />;
	}

	if (!session.data) {
		return (
			<Button
				variant="ghost"
				size="sm"
				className="gap-1.5 h-7 px-2 text-xs"
				onClick={() => {
					authClient.signIn.social({ provider: "github" });
				}}
			>
				<GitHubIcon className="size-3.5" />
				Sign in
			</Button>
		);
	}

	const user = session.data.user;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm transition-colors hover:bg-muted"
				>
					<Avatar className="size-6">
						<AvatarImage src={user.image ?? undefined} alt={user.name} />
						<AvatarFallback className="text-[10px]">
							{getInitials(user.name)}
						</AvatarFallback>
					</Avatar>
					<span className="truncate text-xs font-medium">{user.name}</span>
				</button>
			</DropdownMenuTrigger>

			<DropdownMenuContent align="start" side="top" className="w-52">
				<DropdownMenuLabel className="font-normal">
					<div className="flex flex-col gap-1">
						<p className="text-sm font-medium leading-none">{user.name}</p>
						<p className="text-xs leading-none text-muted-foreground">
							{user.email}
						</p>
					</div>
				</DropdownMenuLabel>

				<DropdownMenuSeparator />

				<DropdownMenuItem
					onClick={() => {
						authClient.signOut();
					}}
				>
					<LogOut className="mr-2 size-3.5" />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
