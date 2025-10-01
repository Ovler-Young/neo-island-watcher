import type { CommandDefinition } from "../types.ts";

export const help: CommandDefinition = {
	name: "help",
	description: "Show detailed help information",
	handler: () => {
		return Promise.resolve(
			"🆘 Neo Island Watcher Help\n\n" +
				"Commands:\n" +
				"• /setcookie [userId] [cookie] - Set XDNMB auth cookie\n" +
				"• /bindfeed [feedUuid] - Bind XDNMB feed to group\n" +
				"• /unbindfeed [feedUuid] - Remove feed binding\n" +
				"• /reply [message] - Post reply to thread (use in topic)\n" +
				"• /r [number] - Roll dice (default 1-10)\n" +
				"• /subscribe - Subscribe to thread (use in topic)\n" +
				"• /unsubscribe - Unsubscribe from thread\n\n" +
				"💡 Most commands work in group topics for specific threads.",
		);
	},
};
