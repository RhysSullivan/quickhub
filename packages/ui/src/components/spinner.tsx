import { Loader2Icon } from "@packages/ui/components/icons";
import { cn } from "@packages/ui/lib/utils";
import * as React from "react";

const Spinner = React.forwardRef<SVGSVGElement, React.ComponentProps<"svg">>(
	({ className, ...props }) => {
		return (
			<Loader2Icon
				role="status"
				aria-label="Loading"
				className={cn("size-4 animate-spin", className)}
				{...props}
			/>
		);
	},
);

Spinner.displayName = "Spinner";

export { Spinner };
