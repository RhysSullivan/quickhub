import { redirect } from "next/navigation";

export default async function RepoPage(props: {
	params: Promise<{ owner: string; name: string }>;
}) {
	const params = await props.params;
	redirect(`/${params.owner}/${params.name}/pulls`);
}
