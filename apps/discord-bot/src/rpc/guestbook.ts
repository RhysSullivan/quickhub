import { api } from "@packages/database/convex/_generated/api";
import type { GuestbookModule } from "@packages/database/convex/rpc/guestbook";
import { createRpcModuleClientContext } from "./client-context";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

const rpcClientContext = createRpcModuleClientContext<GuestbookModule>(
	api.rpc.guestbook,
	{ url: CONVEX_URL },
);

export { rpcClientContext };
