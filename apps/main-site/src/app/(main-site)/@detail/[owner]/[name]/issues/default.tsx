import { CircleDot } from "@packages/ui/components/icons";
import { Suspense } from "react";
import { SyncProgressOverlay } from "../../../../_components/sync-progress-client";

export default async function IssuesDetailDefault({
	params,
}: {
	params: Promise<{ owner: string; name: string }>;
}) {
	const { owner, name } = await params;

	return (
		<Suspense>
			<SyncProgressOverlay owner={owner} name={name}>
				<div className="flex h-full items-center justify-center">
					<div className="text-center">
						<CircleDot className="mx-auto size-10 text-muted-foreground/30" />
						<p className="mt-3 text-sm text-muted-foreground">
							Select an issue to view details
						</p>
					</div>
				</div>
			</SyncProgressOverlay>
		</Suspense>
	);
}
