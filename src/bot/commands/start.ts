import type { CommandDefinition } from "../types.ts";

export const start: CommandDefinition = {
	name: "start",
	description: "Show welcome message and available commands",
	handler: () => {
		return Promise.resolve(
			"🏝️ Welcome to Neo Island Watcher!\n\n" +
				"This bot monitors XDNMB threads and posts updates to Telegram topics.\n\n" +
				"Available commands:\n" +
				"• /setcookie - Set authentication cookie\n" +
				"• /bindfeed - Bind a feed to this group\n" +
				"• /unbindfeed - Unbind feed from this group\n" +
				"• /reply - Reply to a thread\n" +
				"• /r - Roll dice in a thread\n" +
				"• /subscribe - Subscribe to a thread\n" +
				"• /unsubscribe - Unsubscribe from a thread\n" +
				"• /help - Show this help message",
		);
	},
};
