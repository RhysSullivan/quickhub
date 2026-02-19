import { redirect } from "next/navigation";
import { Suspense } from "react";

// Redirect bare /{owner}/{name} to /{owner}/{name}/pulls
export default function RepoPage(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	return (
		<Suspense>
			<RepoRedirect paramsPromise={props.params} />
		</Suspense>
	);
}

async function RepoRedirect({
	paramsPromise,
}: {
	paramsPromise: Promise<{ owner: string; name: string }>;
}): Promise<React.ReactNode> {
	const { owner, name } = await paramsPromise;
	redirect(`/${owner}/${name}/pulls`);
}
