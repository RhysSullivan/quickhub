"use client";

import { Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { Badge } from "@packages/ui/components/badge";
import { Button } from "@packages/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@packages/ui/components/command";
import {
	Check,
	ChevronsUpDown,
	FileText,
	Info,
	Plus,
	Tag,
	X,
} from "@packages/ui/components/icons";
import { Input } from "@packages/ui/components/input";
import { LinkButton } from "@packages/ui/components/link-button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@packages/ui/components/popover";
import { Separator } from "@packages/ui/components/separator";
import { Skeleton } from "@packages/ui/components/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@packages/ui/components/tabs";
import { Textarea } from "@packages/ui/components/textarea";
import { useGithubWrite } from "@packages/ui/rpc/github-write";
import { useIssueTemplates } from "@packages/ui/rpc/issue-templates";
import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { Option } from "effect";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { MarkdownBody } from "@/components/markdown-body";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IssueTemplate = {
	readonly filename: string;
	readonly name: string;
	readonly description: string;
	readonly title: string | null;
	readonly body: string;
	readonly labels: ReadonlyArray<string>;
	readonly assignees: ReadonlyArray<string>;
};

// ---------------------------------------------------------------------------
// Root component — orchestrates template fetch + chooser/form flow
// ---------------------------------------------------------------------------

export function NewIssueClient({
	owner,
	name,
	repositoryId,
}: {
	owner: string;
	name: string;
	repositoryId: number;
}) {
	const templatesClient = useIssueTemplates();

	const fetchAtom = useMemo(
		() =>
			templatesClient.fetchTemplates.callAsQuery({
				ownerLogin: owner,
				name,
			}),
		[templatesClient, owner, name],
	);

	// Fetch fresh templates from GitHub via action-backed read atom
	const fetchResult = useAtomValue(fetchAtom);
	const hasFetched = !Result.isInitial(fetchResult);

	// Subscribe to cached templates for real-time display
	const cachedAtom = useMemo(
		() =>
			templatesClient.getCachedTemplates.subscription({
				ownerLogin: owner,
				name,
			}),
		[templatesClient, owner, name],
	);
	const cachedResult = useAtomValue(cachedAtom);

	const templates: ReadonlyArray<IssueTemplate> = useMemo(() => {
		// Prefer the fetch result if available (freshest)
		if (Result.isSuccess(fetchResult)) {
			const val = Result.value(fetchResult);
			if (Option.isSome(val)) return val.value;
		}
		// Fall back to cached subscription
		if (Result.isSuccess(cachedResult)) {
			const val = Result.value(cachedResult);
			if (Option.isSome(val)) return val.value;
		}
		return [];
	}, [fetchResult, cachedResult]);

	const isLoading = !hasFetched || Result.isWaiting(fetchResult);

	// Track which template was chosen (null = show chooser, undefined = blank)
	const [chosenTemplate, setChosenTemplate] = useState<
		IssueTemplate | "blank" | null
	>(null);

	const effectiveChosenTemplate =
		chosenTemplate ?? (!isLoading && templates.length === 0 ? "blank" : null);

	// Loading state
	if (isLoading && effectiveChosenTemplate === null) {
		return (
			<div className="h-full overflow-y-auto">
				<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
					<Skeleton className="h-6 w-32 mb-1" />
					<Skeleton className="h-3 w-48 mb-6" />
					<div className="space-y-2">
						<Skeleton className="h-16 w-full rounded-lg" />
						<Skeleton className="h-16 w-full rounded-lg" />
						<Skeleton className="h-16 w-full rounded-lg" />
					</div>
				</div>
			</div>
		);
	}

	// Template chooser
	if (effectiveChosenTemplate === null && templates.length > 0) {
		return (
			<TemplateChooser
				owner={owner}
				name={name}
				templates={templates}
				onSelect={(template) => setChosenTemplate(template)}
				onBlank={() => setChosenTemplate("blank")}
			/>
		);
	}

	// Issue form (blank or pre-populated from template)
	const template =
		effectiveChosenTemplate === "blank" ? null : effectiveChosenTemplate;

	return (
		<NewIssueForm
			owner={owner}
			name={name}
			repositoryId={repositoryId}
			template={template}
			showBackToTemplates={templates.length > 0}
			onBackToTemplates={() => setChosenTemplate(null)}
		/>
	);
}

// ---------------------------------------------------------------------------
// Template chooser — shown when repo has templates
// ---------------------------------------------------------------------------

function TemplateChooser({
	owner,
	name,
	templates,
	onSelect,
	onBlank,
}: {
	owner: string;
	name: string;
	templates: ReadonlyArray<IssueTemplate>;
	onSelect: (template: IssueTemplate) => void;
	onBlank: () => void;
}) {
	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
				<div className="mb-6">
					<h1 className="text-lg font-semibold tracking-tight">New issue</h1>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{owner}/{name} &mdash; Choose a template to get started
					</p>
				</div>

				<div className="space-y-2">
					{templates.map((template) => (
						<button
							key={template.filename}
							type="button"
							onClick={() => onSelect(template)}
							className="flex w-full items-start gap-3 rounded-lg border border-border/60 bg-background p-4 text-left transition-colors hover:bg-accent/50 cursor-pointer"
						>
							<FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium">{template.name}</p>
								{template.description.length > 0 && (
									<p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
										{template.description}
									</p>
								)}
								{template.labels.length > 0 && (
									<div className="mt-1.5 flex flex-wrap gap-1">
										{template.labels.map((label) => (
											<Badge
												key={label}
												variant="outline"
												className="text-[9px] px-1.5 py-0"
											>
												{label}
											</Badge>
										))}
									</div>
								)}
							</div>
						</button>
					))}

					{/* Blank issue option */}
					<button
						type="button"
						onClick={onBlank}
						className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border/60 bg-background p-4 text-left transition-colors hover:bg-accent/50 cursor-pointer"
					>
						<Plus className="size-4 shrink-0 text-muted-foreground" />
						<div>
							<p className="text-sm font-medium">Open a blank issue</p>
							<p className="mt-0.5 text-xs text-muted-foreground">
								Start from scratch without a template
							</p>
						</div>
					</button>
				</div>

				<div className="mt-6">
					<LinkButton
						href={`/${owner}/${name}/issues`}
						variant="ghost"
						size="sm"
						className="text-xs"
					>
						Cancel
					</LinkButton>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Issue form — the actual create form
// ---------------------------------------------------------------------------

function NewIssueForm({
	owner,
	name,
	repositoryId,
	template,
	showBackToTemplates,
	onBackToTemplates,
}: {
	owner: string;
	name: string;
	repositoryId: number;
	template: IssueTemplate | null;
	showBackToTemplates: boolean;
	onBackToTemplates: () => void;
}) {
	const router = useRouter();
	const writeClient = useGithubWrite();
	const [createIssueResult, createIssue] = useAtom(
		writeClient.createIssue.call,
		{ mode: "promise" },
	);
	const correlationPrefix = useId();

	const [title, setTitle] = useState(template?.title ?? "");
	const [body, setBody] = useState(template?.body ?? "");
	const [selectedLabels, setSelectedLabels] = useState<ReadonlyArray<string>>(
		template?.labels ?? [],
	);

	const isSubmitting = Result.isWaiting(createIssueResult);

	const handleSubmit = async () => {
		if (title.trim().length === 0) return;
		try {
			await createIssue({
				correlationId: `${correlationPrefix}-create-issue-${Date.now()}`,
				ownerLogin: owner,
				name,
				repositoryId,
				title: title.trim(),
				body: body.trim().length > 0 ? body.trim() : undefined,
				labels: selectedLabels.length > 0 ? [...selectedLabels] : undefined,
			});
			router.push(`/${owner}/${name}/issues`);
		} catch {
			// Error is captured in createIssueResult for display
		}
	};

	const handleToggleLabel = (label: string) => {
		setSelectedLabels((prev) =>
			prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
		);
	};

	const handleRemoveLabel = (label: string) => {
		setSelectedLabels((prev) => prev.filter((l) => l !== label));
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
				{/* Page header */}
				<div className="mb-6">
					<div className="flex items-center gap-3">
						<h1 className="text-lg font-semibold tracking-tight">New issue</h1>
						{template !== null && (
							<Badge variant="outline" className="text-[10px]">
								{template.name}
							</Badge>
						)}
					</div>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{owner}/{name}
					</p>
					{showBackToTemplates && (
						<Button
							variant="link"
							size="sm"
							className="mt-1 h-auto p-0 text-[11px]"
							onClick={onBackToTemplates}
						>
							Choose a different template
						</Button>
					)}
				</div>

				<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
					{/* Main form area */}
					<div className="min-w-0 space-y-4">
						{/* Title */}
						<div>
							<Input
								placeholder="Title"
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								disabled={isSubmitting}
								className="text-base font-medium h-10"
								autoFocus
							/>
						</div>

						{/* Body with Write/Preview tabs */}
						<Tabs defaultValue="write">
							<TabsList className="h-8">
								<TabsTrigger value="write" className="text-xs px-3">
									Write
								</TabsTrigger>
								<TabsTrigger value="preview" className="text-xs px-3">
									Preview
								</TabsTrigger>
							</TabsList>

							<TabsContent value="write" className="mt-2">
								<Textarea
									placeholder="Add a description..."
									value={body}
									onChange={(event) => setBody(event.target.value)}
									disabled={isSubmitting}
									rows={12}
									className="text-sm leading-relaxed"
								/>
								<p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
									<Info className="size-3" />
									Markdown is supported
								</p>
							</TabsContent>

							<TabsContent value="preview" className="mt-2">
								<div className="min-h-[14rem] rounded-md border border-border bg-background p-4">
									{body.trim().length > 0 ? (
										<div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
											<MarkdownBody>{body}</MarkdownBody>
										</div>
									) : (
										<p className="text-sm text-muted-foreground italic">
											Nothing to preview
										</p>
									)}
								</div>
							</TabsContent>
						</Tabs>

						<Separator />

						{/* Submit area */}
						<div className="flex items-center justify-between gap-3">
							<div>
								{Result.isFailure(createIssueResult) && (
									<p className="text-xs text-destructive">
										Failed to create issue. Please try again.
									</p>
								)}
							</div>
							<div className="flex items-center gap-2">
								<LinkButton
									href={`/${owner}/${name}/issues`}
									variant="outline"
									size="sm"
									aria-disabled={isSubmitting}
									className={
										isSubmitting ? "pointer-events-none opacity-50" : ""
									}
								>
									Cancel
								</LinkButton>
								<Button
									size="sm"
									disabled={title.trim().length === 0 || isSubmitting}
									onClick={handleSubmit}
								>
									{isSubmitting ? "Creating..." : "Submit new issue"}
								</Button>
							</div>
						</div>
					</div>

					{/* Sidebar */}
					<div className="space-y-5">
						<NewIssueLabelsPicker
							ownerLogin={owner}
							name={name}
							selectedLabels={selectedLabels}
							onToggle={handleToggleLabel}
							onRemove={handleRemoveLabel}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Labels picker (adapted for new issue — no existing issue number needed)
// ---------------------------------------------------------------------------

function NewIssueLabelsPicker({
	ownerLogin,
	name,
	selectedLabels,
	onToggle,
	onRemove,
}: {
	ownerLogin: string;
	name: string;
	selectedLabels: ReadonlyArray<string>;
	onToggle: (label: string) => void;
	onRemove: (label: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const client = useProjectionQueries();

	const labelsAtom = useMemo(
		() => client.listRepoLabels.subscription({ ownerLogin, name }),
		[client, ownerLogin, name],
	);
	const labelsResult = useAtomValue(labelsAtom);

	const availableLabels = useMemo(() => {
		if (!Result.isSuccess(labelsResult)) return [...selectedLabels];
		const valueOpt = Result.value(labelsResult);
		if (Option.isNone(valueOpt)) return [...selectedLabels];

		const serverLabels = valueOpt.value;
		const labelSet = new Set(serverLabels);
		const extra = selectedLabels.filter((l) => !labelSet.has(l));
		return [...serverLabels, ...extra];
	}, [labelsResult, selectedLabels]);

	const selectedSet = new Set(selectedLabels);

	return (
		<div>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-expanded={open}
						className="flex w-full items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer"
					>
						<span className="inline-flex items-center gap-1">
							<Tag className="size-3" />
							Labels
						</span>
						<ChevronsUpDown className="size-3 opacity-50" />
					</button>
				</PopoverTrigger>
				<PopoverContent className="w-56 p-0" align="start">
					<Command>
						<CommandInput placeholder="Search labels..." />
						<CommandList>
							<CommandEmpty>No labels found.</CommandEmpty>
							<CommandGroup>
								{availableLabels.map((label) => (
									<CommandItem
										key={label}
										value={label}
										onSelect={() => onToggle(label)}
									>
										<span className="text-xs truncate flex-1">{label}</span>
										{selectedSet.has(label) && (
											<Check className="size-3.5 text-primary" />
										)}
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>

			{selectedLabels.length > 0 ? (
				<div className="mt-1.5 flex flex-wrap gap-1">
					{selectedLabels.map((label) => (
						<Badge
							key={label}
							variant="secondary"
							className="text-[10px] gap-1 group"
						>
							{label}
							<button
								type="button"
								onClick={() => onRemove(label)}
								className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity cursor-pointer"
							>
								<X className="size-2.5" />
							</button>
						</Badge>
					))}
				</div>
			) : (
				<p className="mt-1 text-[11px] text-muted-foreground/50">None yet</p>
			)}
		</div>
	);
}
