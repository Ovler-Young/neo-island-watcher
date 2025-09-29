import type { Bot } from "grammy";
import { setupAdminCommands } from "./commands/admin.ts";
import { setupBasicCommands } from "./commands/basic.ts";
import { setupFeedCommands } from "./commands/feed.ts";
import { setupThreadCommands } from "./commands/thread.ts";
import { setupPoCommands } from "./commands/po.ts";

export function setupCommands(bot: Bot) {
	setupBasicCommands(bot);
	setupAdminCommands(bot);
	setupThreadCommands(bot);
	setupPoCommands(bot);
	setupFeedCommands(bot);
}
