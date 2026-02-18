"use client";

import { Button } from "@packages/ui/components/button";
import { usePaginatedAtom } from "@packages/ui/hooks/use-paginated-atom";
import { rpcClientContext } from "@packages/ui/rpc/guestbook";

const PAGE_SIZE = 3;

export function PaginationDemo() {
	const client = rpcClientContext.useRpcClient();
	const paginatedAtom = client.listPaginated.paginated(PAGE_SIZE);
	const { items, hasMore, isLoading, isInitial, isError, loadMore } =
		usePaginatedAtom(paginatedAtom);

	return (
		<div className="w-full max-w-md rounded-lg border p-6">
			<h2 className="mb-4 text-xl font-semibold">Pagination Demo</h2>
			<p className="text-muted-foreground mb-4 text-sm">
				Infinite scroll pagination using Effect atoms. Click &quot;Load
				More&quot; to fetch the next page.
			</p>

			{isInitial ? (
				<div className="space-y-4">
					<p className="text-muted-foreground text-sm">
						Click the button to start loading entries...
					</p>
					<Button onClick={() => loadMore()} className="w-full">
						Start Loading
					</Button>
				</div>
			) : isError ? (
				<p className="text-sm text-red-500">Error loading entries</p>
			) : (
				<div className="space-y-4">
					{items.length === 0 && !isLoading ? (
						<p className="text-muted-foreground text-sm">
							No entries yet. Add some in the guestbook above!
						</p>
					) : (
						<ul className="space-y-3">
							{items.map((entry) => (
								<li key={entry._id} className="border-b pb-2 last:border-b-0">
									<p className="font-medium">{entry.name}</p>
									<p className="text-muted-foreground text-sm">
										{entry.message}
									</p>
								</li>
							))}
						</ul>
					)}

					{hasMore && (
						<Button
							onClick={() => loadMore()}
							disabled={isLoading}
							variant="outline"
							className="w-full"
						>
							{isLoading ? "Loading..." : "Load More"}
						</Button>
					)}

					{!hasMore && items.length > 0 && (
						<p className="text-muted-foreground text-center text-sm">
							No more entries
						</p>
					)}

					<p className="text-muted-foreground text-xs">
						Showing {items.length} entries (page size: {PAGE_SIZE})
					</p>
				</div>
			)}
		</div>
	);
}
