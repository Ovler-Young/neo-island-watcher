import { CommandGroup } from "grammy/commands";
import { xdnmbClient } from "../../api/xdnmb.ts";
import { groupCookies } from "../../storage/group-cookies.ts";
import {
	ensureCookie,
	ensureGroupChat,
	ensureThreadContext,
	withErrorHandler,
} from "../helpers/command-guards.ts";

export function createThreadCommands() {
	const commands = new CommandGroup();

	commands.command(
		"reply",
		"Reply to a thread (use in topic)",
		withErrorHandler(async (ctx) => {
			if (!(await ensureGroupChat(ctx))) return;

			const args = ctx.message?.text?.split(" ");
			if (!args || args.length < 2) {
				await ctx.reply(
					"❌ Usage: /reply [message]\n\n" +
						"Example: /reply This is my response to the thread",
				);
				return;
			}

			const message = args.slice(1).join(" ");
			const cookieResult = await ensureCookie(ctx);
			if (!cookieResult) return;

			const threadId = await ensureThreadContext(ctx);
			if (!threadId) return;

			await groupCookies.updateLastUsed(cookieResult.groupId);

			const result = await xdnmbClient.postReply(
				threadId,
				message,
				cookieResult.cookieData.cookie,
			);

			if (result.includes("发串成功")) {
				await ctx.reply("✅ Reply posted successfully!");
			} else {
				await ctx.reply("❌ Failed to post reply. Please try again.");
			}
		}, "❌ Failed to post reply. Please try again."),
	);

	commands.command(
		"r",
		"Roll dice in a thread",
		withErrorHandler(async (ctx) => {
			if (!(await ensureGroupChat(ctx))) return;

			const args = ctx.message?.text?.split(" ");
			const num = args && args.length > 1 ? Number.parseInt(args[1], 10) : 10;
			const diceRange = Number.isNaN(num) ? "[1,10]" : `[1,${num}]`;

			const cookieResult = await ensureCookie(ctx);
			if (!cookieResult) return;

			const threadId = await ensureThreadContext(ctx);
			if (!threadId) return;

			await groupCookies.updateLastUsed(cookieResult.groupId);

			const result = await xdnmbClient.postReply(
				threadId,
				diceRange,
				cookieResult.cookieData.cookie,
			);

			if (result.includes("发串成功")) {
				await ctx.reply(`🎲 Dice rolled: ${diceRange}`);
			} else {
				await ctx.reply("❌ Failed to roll dice. Please try again.");
			}
		}, "❌ Failed to roll dice. Please try again."),
	);

	return commands;
}
