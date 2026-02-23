import "server-only";

import { createServerRpcQuery } from "@packages/confect/rpc";
import { api } from "@packages/database/convex/_generated/api";
import type { AdminModule } from "@packages/database/convex/rpc/admin";
import { getToken } from "@/lib/auth-server";

const CONVEX_URL =
	process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export const serverAdmin = createServerRpcQuery<AdminModule>(api.rpc.admin, {
	url: CONVEX_URL,
	getAuthToken: getToken,
});
