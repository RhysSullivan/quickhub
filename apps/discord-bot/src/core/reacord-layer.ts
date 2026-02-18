import { type Reacord, ReacordLive } from "@packages/reacord";
import { Effect, Layer } from "effect";
import { DiscordClient } from "./discord-client-service";

export const ReacordLayer: Layer.Layer<Reacord, never, DiscordClient> =
	Layer.unwrapEffect(
		Effect.gen(function* () {
			const client = yield* DiscordClient;
			return ReacordLive(client, {});
		}),
	);
