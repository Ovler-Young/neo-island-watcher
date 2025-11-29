import { bot } from "../../bot/bot.ts";
import { splitLongMessage } from "../../services/formatter.ts";
import { formatThreadAsMarkdown } from "../../services/markdown-formatter.ts";
import type { CommandDefinition } from "../types.ts";

export const get: CommandDefinition = {
	name: "get",
	description: "Get complete thread content as markdown",
	guards: ["groupOnly", "threadContext", "groupBinding"],
	handler: async ({ threadId, ctx }) => {
		try {
			// Format thread as markdown
			const markdown = await formatThreadAsMarkdown(threadId);

			// Split into chunks if needed
			const chunks = splitLongMessage(markdown);

			// Send first chunk as reply
			await ctx.reply(chunks[0], {
				parse_mode: "HTML",
				link_preview_options: { is_disabled: true },
			});

			// Send remaining chunks if any
			for (let i = 1; i < chunks.length; i++) {
				await bot.api.sendMessage(ctx.chat!.id, chunks[i], {
					message_thread_id: ctx.message?.message_thread_id,
					parse_mode: "HTML",
					link_preview_options: { is_disabled: true },
				});
			}

			// Return undefined to prevent automatic reply (we already sent messages)
			return undefined;
		} catch (error) {
			console.error(`Error getting thread ${threadId}:`, error);
			return "❌ Failed to get thread content. Please try again.";
		}
	},
};
