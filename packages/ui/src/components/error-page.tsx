"use client";

import { Button } from "@packages/ui/components/button";
import { cn } from "@packages/ui/lib/utils";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";

interface ErrorPageProps {
	error: Error & { digest?: string };
	reset: () => void;
	homeHref?: string;
	className?: string;
}

function ErrorPage({
	error,
	reset,
	homeHref = "/",
	className,
}: ErrorPageProps) {
	return (
		<div
			className={cn(
				"flex min-h-[400px] flex-col items-center justify-center gap-6 p-8 text-center",
				className,
			)}
		>
			<div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
				<AlertTriangle className="size-8 text-destructive" />
			</div>
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					Something went wrong
				</h1>
				<p className="text-muted-foreground max-w-md">
					An unexpected error occurred. Please try again or return to the home
					page.
				</p>
				{error.digest && (
					<p className="text-muted-foreground text-xs">
						Error ID: {error.digest}
					</p>
				)}
			</div>
			<div className="flex gap-3">
				<Button variant="outline" onClick={reset}>
					<RefreshCw className="size-4" />
					Try again
				</Button>
				<Button asChild>
					<a href={homeHref}>
						<Home className="size-4" />
						Go home
					</a>
				</Button>
			</div>
		</div>
	);
}

interface GlobalErrorPageProps {
	error: Error & { digest?: string };
	reset: () => void;
}

function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
	return (
		<html lang="en">
			<body>
				<div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
					<div className="flex size-16 items-center justify-center rounded-full bg-red-100">
						<AlertTriangle className="size-8 text-red-600" />
					</div>
					<div className="space-y-2">
						<h1 className="text-2xl font-semibold tracking-tight">
							Something went wrong
						</h1>
						<p className="max-w-md text-gray-500">
							A critical error occurred. Please try again.
						</p>
						{error.digest && (
							<p className="text-xs text-gray-400">Error ID: {error.digest}</p>
						)}
					</div>
					<button
						type="button"
						onClick={reset}
						className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
					>
						<RefreshCw className="size-4" />
						Try again
					</button>
				</div>
			</body>
		</html>
	);
}

export { ErrorPage, GlobalErrorPage };
