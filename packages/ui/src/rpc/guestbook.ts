"use client";

import { api } from "@packages/database/convex/_generated/api";
import type { GuestbookModule } from "@packages/database/convex/rpc/guestbook";
import { createRpcModuleClientContext } from "./client-context";

export const rpcClientContext = createRpcModuleClientContext<GuestbookModule>(
	api.rpc.guestbook,
);

export type { GuestbookModule };
