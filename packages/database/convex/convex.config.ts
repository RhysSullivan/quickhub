import actionCache from "@convex-dev/action-cache/convex.config";
import migrations from "@convex-dev/migrations/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import { defineApp } from "convex/server";
import betterAuth from "./betterAuth/convex.config";

const app: ReturnType<typeof defineApp> = defineApp();
app.use(betterAuth);
app.use(actionCache);
app.use(migrations);
app.use(rateLimiter);

export default app;
