import {
	AlertIcon,
	ArrowBothIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	CalendarIcon,
	CheckCircleFillIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	CircleIcon,
	CommentIcon,
	CopyIcon,
	DashIcon,
	DeviceDesktopIcon,
	DotFillIcon,
	DownloadIcon,
	FileDirectoryIcon,
	FileIcon,
	GitPullRequestIcon,
	GrabberIcon,
	HomeIcon,
	KebabHorizontalIcon,
	MoonIcon,
	OrganizationIcon,
	PlayIcon,
	PlusIcon,
	SearchIcon,
	SidebarExpandIcon,
	SignOutIcon,
	SunIcon,
	SyncIcon,
	TagIcon,
	WrapIcon,
	XIcon,
} from "@primer/octicons-react";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const AlertTriangle = AlertIcon;
const ArrowLeft = ArrowLeftIcon;
const ArrowRight = ArrowRightIcon;
const ArrowDown = ChevronDownIcon;
const ArrowUp = ChevronUpIcon;
const Check = CheckIcon;
const CheckCircle2 = CheckCircleFillIcon;
const ChevronDown = ChevronDownIcon;
const ChevronLeft = ChevronLeftIcon;
const ChevronRight = ChevronRightIcon;
const ChevronsDown = ArrowBothIcon;
const ChevronsUp = ArrowBothIcon;
const ChevronsUpDown = ArrowBothIcon;
const Bell = CircleIcon;
const CircleDot = DotFillIcon;
const Copy = CopyIcon;
const Download = DownloadIcon;
const FileText = FileIcon;
const File = FileIcon;
const FileCode2 = FileIcon;
const Folder = FileDirectoryIcon;
const FolderOpen = FileDirectoryIcon;
const Activity = SyncIcon;
const GitBranch = GitPullRequestIcon;
const GitPullRequest = GitPullRequestIcon;
const GitCommit = GitPullRequestIcon;
const MessageSquare = CommentIcon;
const Eye = SearchIcon;
const User = OrganizationIcon;
const GripVerticalIcon = GrabberIcon;
const Home = HomeIcon;
const Loader2 = SyncIcon;
const Loader2Icon = SyncIcon;
const MoreHorizontalIcon = KebabHorizontalIcon;
const CircleCheckIcon = CheckCircleFillIcon;
const Ban = AlertIcon;
const Clock = CalendarIcon;
const Clock3 = CalendarIcon;
const InfoIcon = AlertIcon;
const Info = AlertIcon;
const OctagonXIcon = XIcon;
const RotateCcw = SyncIcon;
const ExternalLink = (props: React.SVGProps<SVGSVGElement>) => (
	<ExternalLinkIcon {...props} />
);
const FileDiff = FileIcon;
const Rows3 = FileDirectoryIcon;
const Columns2 = FileDirectoryIcon;
const Package = FileDirectoryIcon;
const ShieldAlert = AlertIcon;
const ShieldCheck = CheckCircleFillIcon;
const Rocket = PlayIcon;
const TriangleAlert = AlertIcon;
const ListChecks = CheckIcon;
const Inbox = Folder;
const AlertCircle = AlertIcon;
const GitCommitHorizontal = GitPullRequestIcon;
const Zap = SyncIcon;
const TriangleAlertIcon = AlertIcon;
const LogOut = SignOutIcon;
const MessageCircle = CommentIcon;
const Monitor = DeviceDesktopIcon;
const Moon = MoonIcon;
const MinusIcon = DashIcon;
const MoreHorizontal = KebabHorizontalIcon;
const PanelLeftIcon = SidebarExpandIcon;
const Play = PlayIcon;
const RefreshCw = SyncIcon;
const Search = SearchIcon;
const Sun = SunIcon;
const Plus = PlusIcon;
const Tag = TagIcon;
const Users = OrganizationIcon;
const WrapText = WrapIcon;
const X = XIcon;

const GitHubIcon = (props: React.SVGProps<SVGSVGElement>) => (
	<svg fill="currentColor" viewBox="0 0 24 24" {...props}>
		<path
			fillRule="evenodd"
			d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
			clipRule="evenodd"
		/>
	</svg>
);

const discordIconStyles = cva("", {
	variants: {
		color: {
			blurple:
				"dark:text-blue-400 text-[#5865F2] hover:text-[#7289DA] dark:hover:text-blue-300 transition-all",
			inherit: "text-inherit",
			primary:
				"dark:text-neutral-200 dark:hover:text-neutral-400 text-neutral-800 hover:text-neutral-700 transition-all",
		},
	},
	defaultVariants: {
		color: "inherit",
	},
});

function DiscordIcon(
	props: React.SVGProps<SVGSVGElement> & VariantProps<typeof discordIconStyles>,
) {
	return (
		<svg
			fill="currentColor"
			viewBox="0 0 127.14 96.36"
			className={`${discordIconStyles({ color: props.color })} ${
				props.className ?? ""
			}`}
			{...props}
		>
			<path
				fillRule="evenodd"
				d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
				clipRule="evenodd"
			/>
		</svg>
	);
}

const ExternalLinkIcon = (
	props: React.SVGProps<SVGSVGElement> & { className?: string },
) => {
	const { className, ...rest } = props;
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			strokeWidth={1.5}
			stroke="currentColor"
			className={className ?? "h-4 w-4"}
			{...rest}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
			/>
		</svg>
	);
};

const CloseIcon = () => {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			strokeWidth={1.5}
			stroke="currentColor"
			className="h-6 w-6"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M6 18L18 6M6 6l12 12"
			/>
		</svg>
	);
};

export {
	AlertTriangle,
	Activity,
	AlertCircle,
	ArrowDown,
	ArrowLeft,
	ArrowLeftIcon,
	ArrowRight,
	ArrowRightIcon,
	ArrowUp,
	Ban,
	Bell,
	CalendarIcon,
	Check,
	CheckCircle2,
	CheckIcon,
	ChevronDown,
	ChevronDownIcon,
	ChevronLeft,
	ChevronLeftIcon,
	ChevronRight,
	ChevronRightIcon,
	ChevronsDown,
	ChevronsUp,
	ChevronsUpDown,
	Columns2,
	CircleCheckIcon,
	CircleDot,
	CircleIcon,
	Clock,
	Clock3,
	CloseIcon,
	Copy,
	CopyIcon,
	DiscordIcon,
	Download,
	ExternalLink,
	ExternalLinkIcon,
	File,
	FileCode2,
	FileDiff,
	FileText,
	Folder,
	FolderOpen,
	GitBranch,
	GitHubIcon,
	GitCommit,
	GitCommitHorizontal,
	GitPullRequest,
	GripVerticalIcon,
	Home,
	HomeIcon,
	Info,
	InfoIcon,
	Inbox,
	ListChecks,
	LogOut,
	MessageCircle,
	MessageSquare,
	MoreHorizontal,
	MoreHorizontalIcon,
	Moon,
	MoonIcon,
	Monitor,
	MinusIcon,
	OctagonXIcon,
	Eye,
	Package,
	PanelLeftIcon,
	Play,
	Plus,
	PlusIcon,
	RefreshCw,
	RotateCcw,
	Rows3,
	Search,
	SearchIcon,
	ShieldAlert,
	ShieldCheck,
	Sun,
	SunIcon,
	Tag,
	TagIcon,
	TriangleAlert,
	TriangleAlertIcon,
	User,
	Users,
	WrapText,
	X,
	XIcon,
	Rocket,
	Zap,
	Loader2,
	Loader2Icon,
	ChevronUpIcon,
};
