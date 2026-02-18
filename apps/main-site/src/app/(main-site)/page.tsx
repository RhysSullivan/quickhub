import { GuestbookDemo } from "./guestbook-demo";
import { PaginationDemo } from "./pagination-demo";

export default function HomePage() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
			<div className="text-center">
				<h1 className="text-4xl font-bold">Create Epoch App</h1>
				<p className="mt-4 text-lg text-muted-foreground">
					Effect + Convex + Next.js
				</p>
			</div>

			<div className="flex flex-col gap-8 md:flex-row md:items-start">
				<GuestbookDemo />
				<PaginationDemo />
			</div>

			<div className="max-w-lg text-center text-sm text-muted-foreground">
				<p>
					This demo uses <strong>Effect Atom</strong> for reactive state
					management with <strong>Convex</strong> real-time subscriptions.
				</p>
				<p className="mt-2">
					Messages update in real-time across all connected clients. The
					pagination demo shows cursor-based loading with{" "}
					<strong>Atom.pull</strong>.
				</p>
			</div>
		</main>
	);
}
