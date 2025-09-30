import { CommandGroup } from "grammy/commands";
import { threadStates } from "../../storage/thread-state.ts";
import {
	ensureGroupBinding,
	ensureGroupChat,
	ensureThreadContext,
	withErrorHandler,
} from "../helpers/command-guards.ts";

export function createPoCommands() {
	const commands = new CommandGroup();

	commands.command(
		"po",
		"Set PO user ID for thread notifications",
		withErrorHandler(async (ctx) => {
			if (!(await ensureGroupChat(ctx))) return;

			const args = ctx.message?.text?.split(" ");
			if (!args || args.length !== 2) {
				await ctx.reply("❌ Usage: /po [userId]\n\n" + "Example: /po 12aa6b7");
				return;
			}

			const threadId = await ensureThreadContext(ctx);
			if (!threadId) return;
			const groupBinding = await ensureGroupBinding(ctx);
			if (!groupBinding) return;

			const [, userId] = args;
			await threadStates.setPoUserId(threadId, userId);

			const threadState = await threadStates.getThreadState(threadId);
			const currentPage = threadState
				? Math.floor((threadState.lastReplyCount - 1) / 19) + 1
				: 0;

			let message =
				"✅ PO user ID set successfully!\n" +
				"Thread ID: " +
				threadId +
				"\nUser ID: " +
				userId;

			if (currentPage > 0) {
				message +=
					"\n\n💡 Tip: Author changed and current page > 0. Consider using /resetpage to reset page.";
			}

			await ctx.reply(message);
		}, "❌ Failed to set PO user ID. Please try again."),
	);

	commands.command(
		"all",
		"Notify all users for this thread",
		withErrorHandler(async (ctx) => {
			if (!(await ensureGroupChat(ctx))) return;
			const threadId = await ensureThreadContext(ctx);
			if (!threadId) return;
			const groupBinding = await ensureGroupBinding(ctx);
			if (!groupBinding) return;

			await threadStates.setPoUserId(threadId, "*");

			const threadState = await threadStates.getThreadState(threadId);
			const currentPage = threadState
				? Math.floor((threadState.lastReplyCount - 1) / 19) + 1
				: 0;

			let message = "✅ All users will be notified for this thread.";

			if (currentPage > 0) {
				message +=
					"\n\n💡 Tip: Author changed and current page > 0. Consider using /resetpage to reset page.";
			}

			await ctx.reply(message);
		}, "❌ Failed to set all users notification. Please try again."),
	);

	return commands;
}
