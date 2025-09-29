import { CommandGroup } from "@grammyjs/commands";
import { xdnmbClient } from "../../api/xdnmb.ts";
import { groupCookies } from "../../storage/group-cookies.ts";
import {
	ensureGroupBinding,
	ensureGroupChat,
	ensureThreadContext,
	withErrorHandler,
} from "../helpers/command-guards.ts";

export function createFeedCommands() {
	const commands = new CommandGroup();

	commands.command(
		"subscribe",
		"Subscribe to a thread",
		withErrorHandler(async (ctx) => {
			const chat = await ensureGroupChat(ctx);
			if (!chat) return;
			const threadId = await ensureThreadContext(ctx);
			if (!threadId) return;
			const groupBinding = await ensureGroupBinding(ctx);
			if (!groupBinding) return;

			const result = await xdnmbClient.addFeed(
				groupBinding.boundFeeds,
				threadId,
			);
			await groupCookies.updateLastUsed(chat.id.toString());

			if (result === "订阅大成功→_→") {
				await ctx.reply(`✅ Subscribed to thread ${threadId}!`);
			} else {
				await ctx.reply(`❌ Failed to subscribe: ${result}`);
			}
		}, "❌ Failed to subscribe. Please try again."),
	);

	commands.command(
		"unsubscribe",
		"Unsubscribe from a thread",
		withErrorHandler(async (ctx) => {
			if (!(await ensureGroupChat(ctx))) return;
			const threadId = await ensureThreadContext(ctx);
			if (!threadId) return;
			const groupBinding = await ensureGroupBinding(ctx);
			if (!groupBinding) return;

			const result = await xdnmbClient.delFeed(
				groupBinding.boundFeeds,
				threadId,
			);

			if (result === "取消订阅成功!") {
				await ctx.reply(`✅ Unsubscribed from thread ${threadId}!`);
			} else {
				await ctx.reply(`❌ Failed to unsubscribe: ${result}`);
			}
		}, "❌ Failed to unsubscribe. Please try again."),
	);

	return commands;
}
