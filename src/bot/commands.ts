import type { Bot } from "grammy";
import { all } from "./commands/all.ts";
import { bindfeed } from "./commands/bindfeed.ts";
import { epub } from "./commands/epub.ts";
import { get } from "./commands/get.ts";
import { help } from "./commands/help.ts";
import { md } from "./commands/md.ts";
import { pdf } from "./commands/pdf.ts";
import { po } from "./commands/po.ts";
import { r } from "./commands/r.ts";
import { reply } from "./commands/reply.ts";
import { resetpage } from "./commands/resetpage.ts";
import { setcookie } from "./commands/setcookie.ts";
import { start } from "./commands/start.ts";
import { subscribe } from "./commands/subscribe.ts";
import { tg } from "./commands/tg.ts";
import { unbindfeed } from "./commands/unbindfeed.ts";
import { unsubscribe } from "./commands/unsubscribe.ts";
import { CommandRegistry } from "./registry.ts";

export async function setupCommands(bot: Bot) {
	const registry = new CommandRegistry();

	const allCommands = [
		start,
		help,
		setcookie,
		bindfeed,
		unbindfeed,
		reply,
		r,
		resetpage,
		subscribe,
		unsubscribe,
		po,
		all,
		get,
		md,
		pdf,
		epub,
		tg,
	];

	const commandGroup = registry.registerAll(allCommands);
	bot.use(commandGroup);

	await bot.api.setMyCommands(
		allCommands.map((cmd) => ({
			command: cmd.name,
			description: cmd.description,
		})),
	);
}
