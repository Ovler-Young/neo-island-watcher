import type { Bot } from "grammy";
import { xdnmbClient } from "../../api/xdnmb.ts";
import { groupCookies } from "../../storage/group-cookies.ts";
import { extractThreadIdFromTopic } from "../../utils/telegram.ts";

export function setupThreadCommands(bot: Bot) {
	bot.command("reply", async (ctx) => {
		try {
			if (!ctx.chat || ctx.chat.type === "private") {
				await ctx.reply("❌ This command only works in groups.");
				return;
			}

			const args = ctx.message?.text?.split(" ");
			if (!args || args.length < 2) {
				await ctx.reply(
					"❌ Usage: /reply [message]\n\n" +
						"Example: /reply This is my response to the thread",
				);
				return;
			}

			const message = args.slice(1).join(" ");
			const groupId = ctx.chat.id.toString();

			const cookieData = await groupCookies.getCookie(groupId);
			if (!cookieData) {
				await ctx.reply(
					"❌ No authentication cookie set for this group.\n" +
						"Use /setcookie first to set your XDNMB credentials.",
				);
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

			await groupCookies.updateLastUsed(groupId);

			const result = await xdnmbClient.postReply(
				threadId,
				message,
				cookieData.cookie,
			);

			if (result.includes("发串成功")) {
				await ctx.reply("✅ Reply posted successfully!");
			} else {
				await ctx.reply("❌ Failed to post reply. Please try again.");
			}
		} catch (error) {
			console.error("Error in reply command:", error);
			await ctx.reply("❌ Failed to post reply. Please try again.");
		}
	});

	bot.command("r", async (ctx) => {
		try {
			if (!ctx.chat || ctx.chat.type === "private") {
				await ctx.reply("❌ This command only works in groups.");
				return;
			}

			const args = ctx.message?.text?.split(" ");
			const num = args && args.length > 1 ? Number.parseInt(args[1], 10) : 10;
			const diceRange = Number.isNaN(num) ? "[1,10]" : `[1,${num}]`;

			const groupId = ctx.chat.id.toString();
			const cookieData = await groupCookies.getCookie(groupId);
			if (!cookieData) {
				await ctx.reply(
					"❌ No authentication cookie set for this group.\n" +
						"Use /setcookie first to set your XDNMB credentials.",
				);
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

			await groupCookies.updateLastUsed(groupId);

			const result = await xdnmbClient.postReply(
				threadId,
				diceRange,
				cookieData.cookie,
			);

			if (result.includes("发串成功")) {
				await ctx.reply(`🎲 Dice rolled: ${diceRange}`);
			} else {
				await ctx.reply("❌ Failed to roll dice. Please try again.");
			}
		} catch (error) {
			console.error("Error in roll command:", error);
			await ctx.reply("❌ Failed to roll dice. Please try again.");
		}
	});
}
