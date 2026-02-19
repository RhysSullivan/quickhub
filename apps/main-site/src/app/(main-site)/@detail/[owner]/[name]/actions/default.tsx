import { Play } from "lucide-react";
import { SyncProgressOverlay } from "../../../../_components/sync-progress-client";

export default async function ActionsDetailDefault({
	params,
}: {
	params: Promise<{ owner: string; name: string }>;
}) {
	const { owner, name } = await params;

	return (
		<SyncProgressOverlay owner={owner} name={name}>
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<Play className="mx-auto size-10 text-muted-foreground/30" />
					<p className="mt-3 text-sm text-muted-foreground">
						Select a workflow run to view details
					</p>
				</div>
			</div>
		</SyncProgressOverlay>
	);
}
