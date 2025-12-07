import { Bot } from "grammy";
import { autoRetry } from "grammy/auto-retry";
import { config } from "../config.ts";
import { setupCommands } from "./commands.ts";

export const bot = new Bot(config.telegramBotToken, {
	client: {
		apiRoot: config.telegramApiRoot,
	},
});

bot.api.config.use(autoRetry());

await setupCommands(bot);

bot.catch((err) => {
	console.error("Bot error:", err);
});

bot.on("message", (ctx) => {
	console.log(`Message from ${ctx.from?.username}: ${JSON.stringify(ctx)}`);
});
