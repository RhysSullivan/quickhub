"use client";

import { Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { Button } from "@packages/ui/components/button";
import { Input } from "@packages/ui/components/input";
import { rpcClientContext } from "@packages/ui/rpc/guestbook";
import { Option } from "effect";
import { type FormEvent, useState } from "react";

const EmptyPayload: Record<string, never> = {};

export function GuestbookDemo() {
	const client = rpcClientContext.useRpcClient();
	const entriesAtom = client.list.subscription(EmptyPayload);
	const entriesResult = useAtomValue(entriesAtom);
	const [addResult, addEntry] = useAtom(client.add.mutate, {
		mode: "promiseExit",
	});
	const [name, setName] = useState("");
	const [message, setMessage] = useState("");

	const isSubmitting = Result.isWaiting(addResult);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!name.trim() || !message.trim()) return;

		await addEntry({ name: name.trim(), message: message.trim() });
		setName("");
		setMessage("");
	};

	return (
		<div className="w-full max-w-md rounded-lg border p-6">
			<h2 className="mb-4 text-xl font-semibold">Guestbook</h2>

			<form onSubmit={handleSubmit} className="mb-6 space-y-3">
				<Input
					placeholder="Your name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					disabled={isSubmitting}
				/>
				<Input
					placeholder="Your message"
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					disabled={isSubmitting}
				/>
				<Button type="submit" disabled={isSubmitting} className="w-full">
					{isSubmitting ? "Signing..." : "Sign Guestbook"}
				</Button>
			</form>

			{/* Subscription streams never complete, so Result.isWaiting stays true forever even with data */}
			{Result.isInitial(entriesResult) ? (
				<p className="text-muted-foreground text-sm">Loading...</p>
			) : Result.isFailure(entriesResult) ? (
				<p className="text-sm text-red-500">Error loading entries</p>
			) : (
				(() => {
					const entriesOption = Result.value(entriesResult);
					const entries = Option.isSome(entriesOption)
						? entriesOption.value
						: [];
					if (entries.length === 0) {
						return (
							<p className="text-muted-foreground text-sm">
								No entries yet. Be the first!
							</p>
						);
					}
					return (
						<ul className="space-y-3">
							{entries.slice(0, 10).map((entry) => (
								<li key={entry._id} className="border-b pb-2 last:border-b-0">
									<p className="font-medium">{entry.name}</p>
									<p className="text-muted-foreground text-sm">
										{entry.message}
									</p>
								</li>
							))}
						</ul>
					);
				})()
			)}
		</div>
	);
}
