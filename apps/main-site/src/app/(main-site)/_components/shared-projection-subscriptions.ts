"use client";

import { useProjectionQueries } from "@packages/ui/rpc/projection-queries";
import { useMemo } from "react";

const EmptyPayload: Record<string, never> = {};

type ProjectionQueriesClient = ReturnType<typeof useProjectionQueries>;

const createListReposAtom = (
	client: ProjectionQueriesClient,
	enabled: boolean,
) =>
	client.listRepos.subscription(EmptyPayload, {
		enabled,
	});

const createHomeDashboardAtom = (
	client: ProjectionQueriesClient,
	ownerLogin: string | undefined,
	enabled: boolean,
) =>
	client.getHomeDashboard.subscription(
		{
			ownerLogin,
		},
		{
			enabled,
		},
	);

type ListReposAtom = ReturnType<typeof createListReposAtom>;
type HomeDashboardAtom = ReturnType<typeof createHomeDashboardAtom>;

const listReposAtomCache = new WeakMap<
	ProjectionQueriesClient,
	Map<boolean, ListReposAtom>
>();

const homeDashboardAtomCache = new WeakMap<
	ProjectionQueriesClient,
	Map<string, HomeDashboardAtom>
>();

export const useSharedListReposAtom = (enabled: boolean) => {
	const client = useProjectionQueries();

	return useMemo(() => {
		const existingByEnabled = listReposAtomCache.get(client);
		if (existingByEnabled !== undefined) {
			const existingAtom = existingByEnabled.get(enabled);
			if (existingAtom !== undefined) {
				return existingAtom;
			}
			const nextAtom = createListReposAtom(client, enabled);
			existingByEnabled.set(enabled, nextAtom);
			return nextAtom;
		}

		const nextByEnabled = new Map<boolean, ListReposAtom>();
		const nextAtom = createListReposAtom(client, enabled);
		nextByEnabled.set(enabled, nextAtom);
		listReposAtomCache.set(client, nextByEnabled);
		return nextAtom;
	}, [client, enabled]);
};

export const useSharedHomeDashboardAtom = (
	ownerLogin: string | undefined,
	enabled: boolean,
) => {
	const client = useProjectionQueries();

	return useMemo(() => {
		const cacheKey = `${enabled}:${ownerLogin ?? ""}`;
		const existingByKey = homeDashboardAtomCache.get(client);
		if (existingByKey !== undefined) {
			const existingAtom = existingByKey.get(cacheKey);
			if (existingAtom !== undefined) {
				return existingAtom;
			}
			const nextAtom = createHomeDashboardAtom(client, ownerLogin, enabled);
			existingByKey.set(cacheKey, nextAtom);
			return nextAtom;
		}

		const nextByKey = new Map<string, HomeDashboardAtom>();
		const nextAtom = createHomeDashboardAtom(client, ownerLogin, enabled);
		nextByKey.set(cacheKey, nextAtom);
		homeDashboardAtomCache.set(client, nextByKey);
		return nextAtom;
	}, [client, enabled, ownerLogin]);
};
