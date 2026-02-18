import { makeTestLayer } from "@packages/confect/testing";
import { convexTest } from "@packages/convex-test";
import schema from "./convex/schema";

const modules = import.meta.glob("./convex/**/*.*s");

export const createConvexTestLayer = () =>
	makeTestLayer({
		schema,
		modules,
		convexTest,
	});
