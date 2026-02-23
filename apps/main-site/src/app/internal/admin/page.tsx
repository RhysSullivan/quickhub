import { api } from "@packages/database/convex/_generated/api";
import { Badge } from "@packages/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@packages/ui/components/card";
import { fetchAuthQuery, getToken } from "@/lib/auth-server";
import { serverAdmin } from "@/lib/server-admin";

const formatCount = (value: number) => {
	return new Intl.NumberFormat("en-US").format(value);
};

const formatDateTime = (timestampMs: number) => {
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "short",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(new Date(timestampMs));
};

const formatDuration = (ms: number) => {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
};

export default async function InternalAdminPage() {
	const tokenResult = await getToken()
		.then((token) => ({
			token: token === undefined ? null : token,
			error: null,
		}))
		.catch((error) => ({
			token: null,
			error: error instanceof Error ? error.message : String(error),
		}));

	const authUserResult = await fetchAuthQuery(api.auth.getCurrentUser, {})
		.then((user) => ({ user, error: null }))
		.catch((error) => ({
			user: null,
			error: error instanceof Error ? error.message : String(error),
		}));

	const dashboardViaFetchAuthResult = await fetchAuthQuery(
		api.rpc.admin.dashboardSnapshot,
		{},
	)
		.then((value) => ({ value, error: null }))
		.catch((error) => ({
			value: null,
			error: error instanceof Error ? error.message : String(error),
		}));

	const snapshotResult = await serverAdmin.dashboardSnapshot
		.queryPromise({})
		.then((data) => ({ data, error: null }))
		.catch((error) => ({
			data: null,
			error: error instanceof Error ? error.message : String(error),
		}));

	if (snapshotResult.data === null) {
		const errorMessage = snapshotResult.error ?? "Unknown admin error";
		const convexUrl =
			process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "(unset)";
		const convexSiteUrl =
			process.env.CONVEX_SITE_URL ??
			process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
			"(unset)";
		const isAccessError =
			errorMessage.includes("Admin role is required") ||
			errorMessage.includes("Authentication is required") ||
			errorMessage.includes("not_authenticated") ||
			errorMessage.includes("missing_admin_role");

		return (
			<div className="min-h-screen bg-background px-6 py-8">
				<div className="mx-auto max-w-3xl">
					<Card className="border-destructive/30 bg-destructive/5">
						<CardHeader>
							<CardTitle className="text-destructive">
								{isAccessError
									? "Admin access denied"
									: "Admin backend unavailable"}
							</CardTitle>
							<CardDescription>
								{isAccessError
									? "Your session reached the route, but role authorization failed in Convex middleware."
									: "The admin dashboard route exists, but the backing Convex RPC call failed."}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-2 text-sm">
							<p className="text-muted-foreground">Error</p>
							<p className="font-mono text-xs">{errorMessage}</p>
							<p className="text-muted-foreground">Token present</p>
							<p className="font-mono text-xs">
								{tokenResult.token === null ? "no" : "yes"}
							</p>
							<p className="text-muted-foreground">Token lookup error</p>
							<p className="font-mono text-xs">{tokenResult.error ?? "none"}</p>
							<p className="text-muted-foreground">Token starts with Bearer</p>
							<p className="font-mono text-xs">
								{tokenResult.token?.startsWith("Bearer ") ? "yes" : "no"}
							</p>
							<p className="text-muted-foreground">fetchAuthQuery auth user</p>
							<p className="font-mono text-xs">
								{authUserResult.user === null
									? "null"
									: `${authUserResult.user.email ?? "(no email)"} role=${authUserResult.user.role ?? "(none)"}`}
							</p>
							<p className="text-muted-foreground">fetchAuthQuery error</p>
							<p className="font-mono text-xs">
								{authUserResult.error ?? "none"}
							</p>
							<p className="text-muted-foreground">
								fetchAuthQuery dashboardSnapshot type
							</p>
							<p className="font-mono text-xs">
								{dashboardViaFetchAuthResult.value === null
									? "null"
									: dashboardViaFetchAuthResult.value._tag}
							</p>
							<p className="text-muted-foreground">
								fetchAuthQuery dashboardSnapshot error
							</p>
							<p className="font-mono text-xs">
								{dashboardViaFetchAuthResult.error ?? "none"}
							</p>
							<p className="text-muted-foreground">Convex URL</p>
							<p className="font-mono text-xs break-all">{convexUrl}</p>
							<p className="text-muted-foreground">Convex Site URL</p>
							<p className="font-mono text-xs break-all">{convexSiteUrl}</p>
							<p className="text-muted-foreground">
								If this mentions missing function, deploy/restart Convex so
								`rpc/admin:dashboardSnapshot` is available.
							</p>
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}

	const snapshot = snapshotResult.data;

	const cards = [
		{
			title: "Webhook Pending",
			value: formatCount(snapshot.queue.pending),
			detail: `Retry ${snapshot.queue.retry} · Failed ${snapshot.queue.failed}`,
		},
		{
			title: "Installations",
			value: formatCount(snapshot.counts.installations),
			detail: "Active GitHub App installs",
		},
		{
			title: "Repositories",
			value: formatCount(snapshot.counts.repositories),
			detail: "Tracked repos",
		},
		{
			title: "Sync Jobs",
			value: formatCount(snapshot.counts.syncJobs),
			detail: "Total sync jobs",
		},
	];

	return (
		<div className="min-h-screen bg-[radial-gradient(circle_at_20%_0%,hsl(var(--muted))_0%,transparent_35%),radial-gradient(circle_at_80%_0%,hsl(var(--accent)/0.15)_0%,transparent_40%)] px-6 py-8">
			<div className="mx-auto max-w-7xl space-y-6">
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<Badge variant="outline">Internal</Badge>
						<Badge>Admin</Badge>
					</div>
					<h1 className="text-3xl font-semibold tracking-tight">
						System Operations
					</h1>
					<p className="text-muted-foreground text-sm">
						Live operational snapshot for ingestion and webhook processing.
					</p>
				</div>

				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
					{cards.map((card) => (
						<Card key={card.title} className="border-border/70 bg-card/80">
							<CardHeader>
								<CardDescription>{card.title}</CardDescription>
								<CardTitle className="text-3xl font-semibold">
									{card.value}
								</CardTitle>
							</CardHeader>
							<CardContent className="text-muted-foreground text-xs">
								{card.detail}
							</CardContent>
						</Card>
					))}
				</div>

				<div className="grid gap-4 lg:grid-cols-3">
					<Card className="bg-card/80 lg:col-span-2">
						<CardHeader>
							<CardTitle>Stuck Bootstraps</CardTitle>
							<CardDescription>
								Jobs running past the 30 minute threshold.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{snapshot.stuckBootstraps.length === 0 ? (
								<p className="text-muted-foreground text-sm">
									No stuck bootstraps.
								</p>
							) : null}
							<ul className="space-y-2">
								{snapshot.stuckBootstraps.slice(0, 12).map((job) => (
									<li
										key={job.lockKey}
										className="rounded-md border border-border/60 p-2"
									>
										<p className="font-mono text-xs">{job.lockKey}</p>
										<p className="text-muted-foreground text-xs">
											{job.currentStep ?? "unknown step"} · stuck for{" "}
											{formatDuration(job.stuckForMs)}
										</p>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>

					<Card className="bg-card/80">
						<CardHeader>
							<CardTitle>Dead Letters</CardTitle>
							<CardDescription>
								Latest webhook and bootstrap dead letters.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3 text-sm">
							<div>
								<p className="text-muted-foreground text-xs uppercase">
									Bootstrap
								</p>
								<p>{formatCount(snapshot.deadLetters.bootstrap.length)}</p>
							</div>
							<div>
								<p className="text-muted-foreground text-xs uppercase">
									Webhook
								</p>
								<p>{formatCount(snapshot.deadLetters.webhook.length)}</p>
							</div>
						</CardContent>
					</Card>
				</div>

				<Card className="bg-card/80">
					<CardHeader>
						<CardTitle>Snapshot metadata</CardTitle>
						<CardDescription>
							Resolved from RPC middleware + Better Auth identity.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-2 text-sm md:grid-cols-2">
						<div className="flex items-center justify-between gap-4 rounded border border-border/60 p-2">
							<span className="text-muted-foreground">Generated at</span>
							<span>{formatDateTime(snapshot.generatedAt)}</span>
						</div>
						<div className="flex items-center justify-between gap-4 rounded border border-border/60 p-2">
							<span className="text-muted-foreground">Admin role</span>
							<span>{snapshot.viewer.role ?? "(none)"}</span>
						</div>
						<div className="flex items-center justify-between gap-4 rounded border border-border/60 p-2 md:col-span-2">
							<span className="text-muted-foreground">User ID</span>
							<span className="font-mono text-xs">
								{snapshot.viewer.userId}
							</span>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
