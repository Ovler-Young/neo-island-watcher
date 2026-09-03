import { Bot } from "grammy";
import { config } from "../config.ts";
import { setupCommands } from "./commands.ts";
import { normalizeTelegramFetch } from "./telegram-response.ts";
import { telegramAutoRetry } from "./telegram-retry.ts";

export const bot = new Bot(config.telegramBotToken, {
	client: {
		apiRoot: config.telegramApiRoot,
		fetch: normalizeTelegramFetch(),
	},
});

bot.api.config.use(telegramAutoRetry());

await setupCommands(bot);

bot.catch((err) => {
	console.error("Bot error:", err);
});

bot.on("message", (ctx) => {
	console.log(`Message from ${ctx.from?.username}: ${JSON.stringify(ctx)}`);
});
