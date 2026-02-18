import { Reacord } from "@packages/reacord";
import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import { Console, Effect } from "effect";
import { GuestbookCommand } from "./commands/guestbook";
import { Discord } from "./core/discord-service";

const guestbookCommandDef = new SlashCommandBuilder()
	.setName("guestbook")
	.setDescription("View and sign the guestbook");

export const program = Effect.gen(function* () {
	const discord = yield* Discord;
	const reacord = yield* Reacord;

	yield* discord.client.login();

	const guilds = yield* discord.getGuilds();
	yield* Console.log(`Bot is in ${guilds.length} guilds`);

	for (const guild of guilds) {
		yield* Effect.tryPromise(() =>
			guild.commands.create(guestbookCommandDef.toJSON()),
		).pipe(
			Effect.tap(() => Console.log(`Registered /guestbook in ${guild.name}`)),
			Effect.catchAll(() => Effect.void),
		);
	}

	yield* discord.client.on("interactionCreate", (interaction) =>
		Effect.gen(function* () {
			if (!interaction.isChatInputCommand()) return;

			if (interaction.commandName === "guestbook") {
				yield* reacord.reply(
					interaction as ChatInputCommandInteraction,
					<GuestbookCommand />,
					{ ephemeral: true },
				);
			}
		}),
	);

	return yield* Effect.never;
});
