import "server-only";

import { createServerRpcQuery } from "@packages/confect/rpc";
import { api } from "@packages/database/convex/_generated/api";
import type { NotificationsModule } from "@packages/database/convex/rpc/notifications";
import { getToken } from "@/lib/auth-server";

const CONVEX_URL =
	process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export const serverNotifications = createServerRpcQuery<NotificationsModule>(
	api.rpc.notifications,
	{
		url: CONVEX_URL,
		getAuthToken: getToken,
	},
);
