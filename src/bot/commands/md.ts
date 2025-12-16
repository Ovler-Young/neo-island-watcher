import { InputFile } from "grammy";
import { generateThreadFilename } from "../../utils/filename.ts";
import type { CommandDefinition } from "../types.ts";
import { fetchThread } from "./common/fetch-thread.ts";

export const md: CommandDefinition = {
	name: "md",
	description: "Get thread as Markdown (filtered & all)",
	guards: [],
	handler: async ({ ctx }) => {
		const result = await fetchThread(ctx, "Fetching Markdown for");
		if (!result) return;

		const { threadId, title, filteredMarkdown, allMarkdown, statusMsg } =
			result;
		const chatId = ctx.chat?.id;
		if (!chatId) return undefined;
		const encoder = new TextEncoder();

		try {
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"📝 Sending Markdown files...",
				);
			}

			// Send Filtered Markdown
			const filteredBuffer = encoder.encode(filteredMarkdown);
			const filteredFilename = generateThreadFilename(
				threadId,
				title,
				"filtered",
			);
			const filteredFile = new InputFile(filteredBuffer, filteredFilename);
			await ctx.replyWithDocument(filteredFile);

			// Send All Markdown if available
			if (allMarkdown) {
				const allBuffer = encoder.encode(allMarkdown);
				const allFilename = generateThreadFilename(threadId, title, "all");
				const allFile = new InputFile(allBuffer, allFilename);
				await ctx.replyWithDocument(allFile);
			}

			if (statusMsg) {
				await ctx.api
					.deleteMessage(chatId, statusMsg.message_id)
					.catch(() => {});
			}
		} catch (error) {
			console.error("Error in md command:", error);
			await ctx.reply("❌ Error sending Markdown files.");
		}
		return undefined;
	},
};
