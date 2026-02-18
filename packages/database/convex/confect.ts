import {
	ConfectMutationCtx as ConfectMutationCtxTag,
	type ConfectMutationCtx as ConfectMutationCtxType,
	ConfectQueryCtx as ConfectQueryCtxTag,
	type ConfectQueryCtx as ConfectQueryCtxType,
	ConfectActionCtx as ConfectActionCtxTag,
	type ConfectActionCtx as ConfectActionCtxType,
} from "@packages/confect/ctx";
import { type TablesFromSchemaDefinition } from "@packages/confect/schema";
import { confectSchema } from "./schema";

export { confectSchema };

type Tables = TablesFromSchemaDefinition<typeof confectSchema>;

export const ConfectQueryCtx = ConfectQueryCtxTag<Tables>();
export type ConfectQueryCtx = ConfectQueryCtxType<Tables>;

export const ConfectMutationCtx = ConfectMutationCtxTag<Tables>();
export type ConfectMutationCtx = ConfectMutationCtxType<Tables>;

export const ConfectActionCtx = ConfectActionCtxTag<Tables>();
export type ConfectActionCtx = ConfectActionCtxType<Tables>;
