import * as Metric from "effect/Metric";

export const discordApiCalls = Metric.counter("discord.api.calls", {
	description: "Number of Discord API calls made",
});

export const discordApiErrors = Metric.counter("discord.api.errors", {
	description: "Number of Discord API errors",
});
