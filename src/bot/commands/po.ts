import type { Bot } from "grammy";
import { groupBindings } from "../../storage/group-bindings.ts";
import { threadStates } from "../../storage/thread-state.ts";
import { extractThreadIdFromTopic } from "../../utils/telegram.ts";

export function setupPoCommands(bot: Bot) {
	bot.command("po", async (ctx) => {
		try {
			if (!ctx.chat || ctx.chat.type === "private") {
				await ctx.reply("❌ This command only works in groups.");
				return;
			}

			const args = ctx.message?.text?.split(" ");
			if (!args || args.length !== 2) {
				await ctx.reply("❌ Usage: /po [userId]\n\n" + "Example: /po 12aa6b7");
				return;
			}

			const threadId = await extractThreadIdFromTopic(ctx);
			if (!threadId) {
				await ctx.reply(
					"❌ Unable to determine thread ID.\n" +
						"This command should be used in a thread topic.\n"
				);
				return;
			}

			const groupBinding = await groupBindings.getGroupBinding(
				ctx.chat.id.toString(),
			);
			if (!groupBinding) {
				await ctx.reply(
					"❌ No feed bound to this group.\n" +
						"Use /bindfeed first to bind a feed.",
				);
				return;
			}
			const [, userId] = args;

			await threadStates.setPoUserId(threadId, userId);

			await ctx.reply(
				"✅ PO user ID set successfully!\n" +
					"Thread ID: " +
					threadId +
					"\nUser ID: " +
					userId,
			);
		} catch (error) {
			console.error("Error in po command:", error);
			await ctx.reply("❌ Failed to set PO user ID. Please try again.");
		}
	});

	bot.command("all", async (ctx) => {
		try {
			if (!ctx.chat || ctx.chat.type === "private") {
				await ctx.reply("❌ This command only works in groups.");
				return;
			}

			const threadId = await extractThreadIdFromTopic(ctx);
			if (!threadId) {
				await ctx.reply(
					"❌ Unable to determine thread ID.\n" +
						"This command should be used in a thread topic.\n"
				);
				return;
			}
			const groupBinding = await groupBindings.getGroupBinding(
				ctx.chat.id.toString(),
			);
			if (!groupBinding) {
				await ctx.reply(
					"❌ No feed bound to this group.\n" +
						"Use /bindfeed first to bind a feed.",
				);
				return;
			}

			await threadStates.setPoUserId(threadId, "*");
			await ctx.reply("✅ All users will be notified for this thread.");
		} catch (error) {
			console.error("Error in all command:", error);
			await ctx.reply(
				"❌ Failed to set all users notification. Please try again.",
			);
		}
	});
}
