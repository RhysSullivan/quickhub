import { api } from "@packages/database/convex/_generated/api";
import { Either, Schema } from "effect";
import { File } from "lucide-react";
import { fetchAuthAction, fetchAuthMutation } from "@/lib/auth-server";
import { FileViewerMonaco } from "./file-viewer-monaco";

const FilePayloadSchema = Schema.NullOr(
	Schema.Struct({
		path: Schema.String,
		sha: Schema.String,
		content: Schema.NullOr(Schema.String),
		size: Schema.Number,
	}),
);

const NestedFilePayloadSchema = Schema.Struct({
	_tag: Schema.Literal("Success"),
	value: FilePayloadSchema,
});

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getErrorMessage(error: Error): string {
	const message = error.message.toLowerCase();
	if (
		message.includes("not signed in") ||
		message.includes("notauthenticated")
	) {
		return "Sign in to browse code";
	}
	if (
		message.includes("reponotfound") ||
		message.includes("repository not found")
	) {
		return "Repository not found";
	}
	return "Failed to load file";
}

export async function FileViewer({
	owner,
	name,
	path,
	treeSha,
}: {
	owner: string;
	name: string;
	path: string | null;
	treeSha: string | null;
}) {
	if (path === null) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted-foreground">
					Select a file from the tree to view its contents
				</p>
			</div>
		);
	}

	try {
		const actionResult = await fetchAuthAction(
			api.rpc.codeBrowse.getFileContent,
			{
				ownerLogin: owner,
				name,
				path,
				ref: "HEAD",
			},
		);

		if (actionResult._tag !== "Success") {
			return (
				<div className="flex h-full items-center justify-center">
					<p className="text-xs text-muted-foreground">Failed to load file</p>
				</div>
			);
		}

		const decodedDirect = Schema.decodeUnknownEither(FilePayloadSchema)(
			actionResult.value,
		);
		const fileData = Either.isRight(decodedDirect)
			? decodedDirect.right
			: Either.isRight(
						Schema.decodeUnknownEither(NestedFilePayloadSchema)(
							actionResult.value,
						),
					)
				? Schema.decodeUnknownSync(NestedFilePayloadSchema)(actionResult.value)
						.value
				: null;

		if (!Either.isRight(decodedDirect) && fileData === null) {
			const nestedResult = Schema.decodeUnknownEither(NestedFilePayloadSchema)(
				actionResult.value,
			);
			if (Either.isLeft(nestedResult)) {
				return (
					<div className="flex h-full items-center justify-center">
						<p className="text-xs text-muted-foreground">Failed to load file</p>
					</div>
				);
			}
		}

		if (fileData === null) {
			return (
				<div className="flex h-full items-center justify-center">
					<p className="text-xs text-muted-foreground">File not found</p>
				</div>
			);
		}

		if (fileData.content === null) {
			const resolvedTreeSha = treeSha ?? "HEAD";

			await fetchAuthMutation(api.rpc.codeBrowse.markFileRead, {
				ownerLogin: owner,
				name,
				treeSha: resolvedTreeSha,
				path: fileData.path,
				fileSha: fileData.sha,
			}).catch(() => null);

			return (
				<div className="flex h-full flex-col">
					<div className="flex items-center gap-2 border-b px-3 py-2">
						<File className="size-3 text-muted-foreground" />
						<span className="truncate text-xs font-medium">
							{fileData.path}
						</span>
						<span className="ml-auto text-[10px] text-muted-foreground">
							{formatBytes(fileData.size)}
						</span>
					</div>
					<div className="flex flex-1 items-center justify-center">
						<p className="text-xs text-muted-foreground">
							Binary file - cannot display
						</p>
					</div>
				</div>
			);
		}

		const lineCount = fileData.content.split("\n").length;
		const resolvedTreeSha = treeSha ?? "HEAD";
		await fetchAuthMutation(api.rpc.codeBrowse.markFileRead, {
			ownerLogin: owner,
			name,
			treeSha: resolvedTreeSha,
			path: fileData.path,
			fileSha: fileData.sha,
		}).catch(() => null);

		return (
			<div className="flex h-full flex-col">
				<div className="flex items-center gap-2 border-b px-3 py-2">
					<File className="size-3 text-muted-foreground" />
					<span className="truncate text-xs font-medium">{fileData.path}</span>
					<span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
						{lineCount} lines - {formatBytes(fileData.size)}
					</span>
				</div>
				<div className="flex-1 overflow-auto">
					<FileViewerMonaco path={fileData.path} content={fileData.content} />
				</div>
			</div>
		);
	} catch (error) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-xs text-muted-foreground">
					{error instanceof Error
						? getErrorMessage(error)
						: "Failed to load file"}
				</p>
			</div>
		);
	}
}
