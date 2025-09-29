import { CommandGroup } from "@grammyjs/commands";
import { feedStates } from "../../storage/feed-state.ts";
import { groupBindings } from "../../storage/group-bindings.ts";
import { groupCookies } from "../../storage/group-cookies.ts";

export function createAdminCommands() {
	const commands = new CommandGroup();

	commands.command(
		"setcookie",
		"Set XDNMB authentication cookie",
		async (ctx) => {
			try {
				if (!ctx.chat || ctx.chat.type === "private") {
					await ctx.reply("❌ This command only works in groups.");
					return;
				}

				const args = ctx.message?.text?.split(" ");
				if (!args || args.length !== 3) {
					await ctx.reply(
						"❌ Usage: /setcookie [userId] [cookie]\n\n" +
							"Example: /setcookie 12aa6b7 %08%ECcI%06%09mS%3F%82%CD%D3...",
					);
					return;
				}

				const [, userId, cookie] = args;
				const groupId = ctx.chat.id.toString();
				const telegramUserId = ctx.from?.id;

				if (!telegramUserId) {
					await ctx.reply("❌ Unable to identify user.");
					return;
				}

				await groupCookies.setCookie(groupId, userId, cookie, telegramUserId);

				await ctx.reply("✅ Cookie set successfully!");
			} catch (error) {
				console.error("Error in setcookie command:", error);
				await ctx.reply("❌ Failed to set cookie. Please try again.");
			}
		},
	);

	commands.command(
		"bindfeed",
		"Bind an XDNMB feed to this group",
		async (ctx) => {
			try {
				if (!ctx.chat || ctx.chat.type === "private") {
					await ctx.reply("❌ This command only works in groups.");
					return;
				}

				const args = ctx.message?.text?.split(" ");
				if (!args || args.length !== 2) {
					await ctx.reply(
						"❌ Usage: /bindfeed [feedUuid]\n\n" +
							"Example: /bindfeed abc123-def456-ghi789",
					);
					return;
				}

				const [, feedUuid] = args;
				const groupId = ctx.chat.id.toString();

				await feedStates.bindGroupToFeed(feedUuid, ctx.chat.id);
				await groupBindings.bindFeedToGroup(groupId, feedUuid);

				await ctx.reply(
					`✅ Feed ${feedUuid} bound to this group!\n\n` +
						"🔄 Starting to monitor threads and create topics...",
				);
			} catch (error) {
				console.error("Error in bindfeed command:", error);
				await ctx.reply("❌ Failed to bind feed. Please try again.");
			}
		},
	);

	commands.command("unbindfeed", "Unbind feed from this group", async (ctx) => {
		try {
			if (!ctx.chat || ctx.chat.type === "private") {
				await ctx.reply("❌ This command only works in groups.");
				return;
			}

			const args = ctx.message?.text?.split(" ");
			if (!args || args.length !== 2) {
				await ctx.reply(
					"❌ Usage: /unbindfeed [feedUuid]\n\n" +
						"Example: /unbindfeed abc123-def456-ghi789",
				);
				return;
			}

			const [, feedUuid] = args;
			const groupId = ctx.chat.id.toString();

			await feedStates.unbindGroupFromFeed(feedUuid, ctx.chat.id);
			await groupBindings.unbindFeedFromGroup(groupId);

			await ctx.reply(`✅ Feed ${feedUuid} unbound from this group!`);
		} catch (error) {
			console.error("Error in unbindfeed command:", error);
			await ctx.reply("❌ Failed to unbind feed. Please try again.");
		}
	});

	return commands;
}
