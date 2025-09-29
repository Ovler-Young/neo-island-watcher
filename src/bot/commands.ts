import type { Bot } from "grammy";
import { createAdminCommands } from "./commands/admin.ts";
import { createBasicCommands } from "./commands/basic.ts";
import { createFeedCommands } from "./commands/feed.ts";
import { createPoCommands } from "./commands/po.ts";
import { createThreadCommands } from "./commands/thread.ts";

export async function setupCommands(bot: Bot) {
	const basicCommands = createBasicCommands();
	const adminCommands = createAdminCommands();
	const threadCommands = createThreadCommands();
	const poCommands = createPoCommands();
	const feedCommands = createFeedCommands();

	bot.use(basicCommands);
	bot.use(adminCommands);
	bot.use(threadCommands);
	bot.use(poCommands);
	bot.use(feedCommands);

	// Sync command menu to Telegram
	await basicCommands.setCommands(bot);
}
