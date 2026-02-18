import { api } from "@packages/database/convex/_generated/api";
import type { GuestbookModule } from "@packages/database/convex/rpc/guestbook";
import { rpcClientContext } from "@packages/ui/rpc/guestbook";
import { createRpcModuleTestContext } from "@packages/ui/rpc/test-context";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { GuestbookDemo } from "./guestbook-demo";

const guestbookComponentTestContext =
	createRpcModuleTestContext<GuestbookModule>({
		moduleApi: api.rpc.guestbook,
		wrapChildren: (children, client) =>
			createElement(rpcClientContext.RpcClientProvider, { client }, children),
	});

afterEach(() => {
	cleanup();
});

describe("GuestbookDemo component", () => {
	it("renders seeded entries", async () => {
		const { client, wrapper } = guestbookComponentTestContext;

		await client.add.mutatePromise({
			message: "Preloaded message",
			name: "Preloaded user",
		});

		render(<GuestbookDemo />, { wrapper });

		await waitFor(() => {
			screen.getByText("Preloaded user");
			screen.getByText("Preloaded message");
		});
	});

	it("submits a new entry through UI", async () => {
		const { wrapper } = guestbookComponentTestContext;

		render(<GuestbookDemo />, { wrapper });

		const nameInput = screen.getByPlaceholderText("Your name");
		const messageInput = screen.getByPlaceholderText("Your message");
		const submitButton = screen.getByRole("button", { name: "Sign Guestbook" });

		fireEvent.change(nameInput, { target: { value: "Alice" } });
		fireEvent.change(messageInput, {
			target: { value: "Hello from component test" },
		});
		fireEvent.click(submitButton);

		await waitFor(() => {
			screen.getByText("Alice");
			screen.getByText("Hello from component test");
		});

		if (nameInput instanceof HTMLInputElement) {
			expect(nameInput.value).toBe("");
		}
		if (messageInput instanceof HTMLInputElement) {
			expect(messageInput.value).toBe("");
		}
	});
});
