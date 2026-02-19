/**
 * Localized skeleton fallbacks for Suspense boundaries inside page.tsx files.
 * These are intentionally lightweight — they show inside the panel, not replacing it.
 */

export function ListSkeleton() {
	return (
		<div className="flex h-full flex-col animate-pulse">
			<div className="shrink-0 border-b p-3 space-y-2">
				<div className="h-4 w-24 rounded bg-muted" />
				<div className="flex gap-2">
					<div className="h-6 w-12 rounded bg-muted" />
					<div className="h-6 w-12 rounded bg-muted" />
					<div className="h-6 w-12 rounded bg-muted" />
				</div>
			</div>
			<div className="flex-1 p-2 space-y-2">
				{Array.from({ length: 8 }, (_, i) => (
					<div key={i} className="flex gap-2 rounded-md px-2.5 py-2">
						<div className="size-3.5 rounded-full bg-muted shrink-0 mt-0.5" />
						<div className="flex-1 space-y-1.5">
							<div className="h-3 w-3/4 rounded bg-muted" />
							<div className="h-2.5 w-1/2 rounded bg-muted" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export function DetailSkeleton() {
	return (
		<div className="flex h-full animate-pulse">
			{/* Main area: diff skeleton */}
			<div className="flex-1 min-w-0 p-4 space-y-4">
				{/* Header */}
				<div className="flex items-start gap-2">
					<div className="size-5 rounded-full bg-muted shrink-0 mt-1" />
					<div className="flex-1 space-y-2">
						<div className="h-5 w-2/3 rounded bg-muted" />
						<div className="flex gap-2">
							<div className="h-3 w-10 rounded bg-muted" />
							<div className="h-3 w-14 rounded-full bg-muted" />
							<div className="h-3 w-20 rounded bg-muted" />
						</div>
					</div>
				</div>

				{/* Files changed header */}
				<div className="flex items-center gap-2">
					<div className="h-4 w-28 rounded bg-muted" />
					<div className="h-3 w-20 rounded bg-muted" />
				</div>

				{/* Diff file blocks */}
				{Array.from({ length: 3 }, (_, i) => (
					<div key={i} className="space-y-0">
						<div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 rounded-t-md border border-b-0">
							<div className="size-4 rounded bg-muted" />
							<div className="h-3 w-48 rounded bg-muted" />
							<div className="ml-auto flex gap-1.5">
								<div className="h-3 w-6 rounded bg-muted" />
								<div className="h-3 w-6 rounded bg-muted" />
							</div>
						</div>
						<div className="rounded-b-md border p-2 space-y-1.5">
							{[85, 72, 93, 60, 78].map((w, j) => (
								<div
									key={j}
									className="h-3 rounded bg-muted"
									style={{ width: `${w}%` }}
								/>
							))}
						</div>
					</div>
				))}
			</div>

			{/* Right sidebar skeleton — hidden below lg, matches PR detail */}
			<div className="hidden lg:block w-80 xl:w-96 shrink-0 border-l border-border/60 p-3 space-y-4 bg-muted/20">
				{/* Branches */}
				<div className="space-y-1">
					<div className="h-2.5 w-16 rounded bg-muted" />
					<div className="flex items-center gap-1.5">
						<div className="h-4 w-20 rounded bg-muted" />
						<div className="h-3 w-3 rounded bg-muted" />
						<div className="h-4 w-16 rounded bg-muted" />
					</div>
				</div>

				{/* Badges */}
				<div className="flex gap-1.5">
					<div className="h-5 w-24 rounded-full bg-muted" />
					<div className="h-5 w-16 rounded-full bg-muted" />
				</div>

				{/* Action buttons */}
				<div className="flex gap-2">
					<div className="h-7 w-16 rounded bg-muted" />
					<div className="h-7 w-14 rounded bg-muted" />
				</div>

				{/* Description */}
				<div className="space-y-1.5">
					<div className="h-2.5 w-20 rounded bg-muted" />
					<div className="rounded-md border p-3 space-y-2">
						<div className="h-3 w-full rounded bg-muted" />
						<div className="h-3 w-5/6 rounded bg-muted" />
						<div className="h-3 w-4/6 rounded bg-muted" />
						<div className="h-3 w-3/4 rounded bg-muted" />
					</div>
				</div>

				{/* Checks */}
				<div className="space-y-1.5">
					<div className="h-2.5 w-14 rounded bg-muted" />
					<div className="rounded-md border divide-y">
						{Array.from({ length: 3 }, (_, i) => (
							<div
								key={i}
								className="flex items-center justify-between px-2.5 py-1.5"
							>
								<div className="flex items-center gap-2">
									<div className="size-3.5 rounded-full bg-muted" />
									<div className="h-3 w-24 rounded bg-muted" />
								</div>
								<div className="h-4 w-14 rounded-full bg-muted" />
							</div>
						))}
					</div>
				</div>

				{/* Comments */}
				<div className="space-y-1.5">
					<div className="h-2.5 w-18 rounded bg-muted" />
					{Array.from({ length: 2 }, (_, i) => (
						<div key={i} className="rounded-md border p-2.5 space-y-1.5">
							<div className="flex items-center gap-1.5">
								<div className="size-4 rounded-full bg-muted" />
								<div className="h-3 w-16 rounded bg-muted" />
								<div className="h-2.5 w-10 rounded bg-muted" />
							</div>
							<div className="h-3 w-full rounded bg-muted" />
							<div className="h-3 w-3/4 rounded bg-muted" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
