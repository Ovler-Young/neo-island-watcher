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

			await ctx.reply(
				"✅ PO user ID set successfully!\n" +
					"Thread ID: " +
					threadId +
					"\nUser ID: " +
					userId,
			);
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
			await ctx.reply("✅ All users will be notified for this thread.");
		}, "❌ Failed to set all users notification. Please try again."),
	);

	return commands;
}
