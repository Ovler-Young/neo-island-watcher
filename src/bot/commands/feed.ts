import type { Bot } from "grammy";
import { xdnmbClient } from "../../api/xdnmb.ts";
import { groupBindings } from "../../storage/group-bindings.ts";
import { groupCookies } from "../../storage/group-cookies.ts";
import { extractThreadIdFromTopic } from "../../utils/telegram.ts";

export function setupFeedCommands(bot: Bot) {
	bot.command("subscribe", async (ctx) => {
		try {
			if (!ctx.chat || ctx.chat.type === "private") {
				await ctx.reply("❌ This command only works in groups.");
				return;
			}

			const threadId = await extractThreadIdFromTopic(ctx);
			if (!threadId) {
				await ctx.reply(
					"❌ Unable to determine thread ID.\n" +
						"This command should be used in a thread topic.",
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

			const result = await xdnmbClient.addFeed(
				groupBinding.boundFeeds,
				threadId,
			);
			await groupCookies.updateLastUsed(ctx.chat.id.toString());

			if (result === "订阅大成功→_→") {
				await ctx.reply(`✅ Subscribed to thread ${threadId}!`);
			} else {
				await ctx.reply(`❌ Failed to subscribe: ${result}`);
			}
		} catch (error) {
			console.error("Error in subscribe command:", error);
			await ctx.reply("❌ Failed to subscribe. Please try again.");
		}
	});

	bot.command("unsubscribe", async (ctx) => {
		try {
			if (!ctx.chat || ctx.chat.type === "private") {
				await ctx.reply("❌ This command only works in groups.");
				return;
			}

			const threadId = await extractThreadIdFromTopic(ctx);
			if (!threadId) {
				await ctx.reply(
					"❌ Unable to determine thread ID.\n" +
						"This command should be used in a thread topic.",
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

			const result = await xdnmbClient.delFeed(
				groupBinding.boundFeeds,
				threadId,
			);

			if (result === "取消订阅成功!") {
				await ctx.reply(`✅ Unsubscribed from thread ${threadId}!`);
			} else {
				await ctx.reply(`❌ Failed to unsubscribe: ${result}`);
			}
		} catch (error) {
			console.error("Error in unsubscribe command:", error);
			await ctx.reply("❌ Failed to unsubscribe. Please try again.");
		}
	});
}
