import { ArrowLeft } from "lucide-react";

export default function ListDefault() {
	return (
		<div className="flex h-full items-center justify-center">
			<div className="text-center">
				<div className="mx-auto size-12 rounded-full bg-muted/40 flex items-center justify-center">
					<ArrowLeft className="size-5 text-muted-foreground/30" />
				</div>
				<p className="mt-3 text-xs font-medium text-muted-foreground">
					Select a repository
				</p>
			</div>
		</div>
	);
}
