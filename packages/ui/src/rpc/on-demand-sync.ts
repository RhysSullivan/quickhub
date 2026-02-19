"use client";

import { api } from "@packages/database/convex/_generated/api";
import type { OnDemandSyncModule } from "@packages/database/convex/rpc/onDemandSync";
import { createRpcModuleClientContext } from "./client-context";

export const {
	RpcClientProvider: OnDemandSyncProvider,
	useRpcClient: useOnDemandSync,
} = createRpcModuleClientContext<OnDemandSyncModule>(api.rpc.onDemandSync);
