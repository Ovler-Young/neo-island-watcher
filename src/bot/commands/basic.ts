import type { Bot } from "grammy";

export function setupBasicCommands(bot: Bot) {
	bot.command("start", (ctx) => {
		ctx.reply(
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
	});

	bot.command("help", (ctx) => {
		ctx.reply(
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
	});
}
