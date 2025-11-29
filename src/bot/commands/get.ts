import { InputFile } from "grammy";
import type { ProgressInfo } from "../../api/types.ts";
import { formatThreadAsMarkdown } from "../../services/markdown-formatter.ts";
import { generateThreadFilename } from "../../utils/filename.ts";
import type { CommandDefinition } from "../types.ts";

export const get: CommandDefinition = {
	name: "get",
	description: "Get complete thread content as markdown",
	guards: ["groupOnly", "threadContext", "groupBinding"],
	handler: async ({ threadId, ctx }) => {
		let statusMsg: { message_id: number } | null = null;
		let lastUpdate = 0;
		const chatId = ctx.chat?.id;
		if (!chatId) {
			return "❌ No chat found";
		}

		try {
			// Send initial status message
			statusMsg = await ctx.reply("📥 Fetching thread...");
			lastUpdate = Date.now();

			// Format thread as markdown with progress tracking
			const { markdown, threadData } = await formatThreadAsMarkdown(
				threadId,
				(progress: ProgressInfo) => {
					const now = Date.now();
					// Update every 10 seconds
					if (now - lastUpdate >= 10000 && statusMsg) {
						ctx.api
							.editMessageText(
								chatId,
								statusMsg.message_id,
								`📥 Fetching thread... Page ${progress.current}/${progress.total} (${progress.percentage}%)`,
							)
							.catch(() => {
								/* Ignore edit errors */
							});
						lastUpdate = now;
					}
				},
			);

			console.log(`Markdown generated, length: ${markdown.length} chars`);

			// Update status to generating file
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"✅ Generating file...",
				);
			}

			// Create file with proper filename
			const encoder = new TextEncoder();
			const buffer = encoder.encode(markdown);
			const filename = generateThreadFilename(threadId, threadData.title);
			const file = new InputFile(buffer, filename);

			console.log(`Sending document file: ${filename}`);

			// Send as document
			await ctx.replyWithDocument(file, {
				caption: `Thread ${threadId} markdown export`,
			});

			// Delete status message
			if (statusMsg) {
				await ctx.api.deleteMessage(chatId, statusMsg.message_id);
			}

			console.log(`Document sent successfully for thread ${threadId}`);
			return undefined;
		} catch (error) {
			console.error(`Error getting thread ${threadId}:`, error);
			if (error instanceof Error) {
				console.error(`Error message: ${error.message}`);
				console.error(`Error stack: ${error.stack}`);
			}

			// Clean up status message if it exists
			if (statusMsg) {
				await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {
					/* Ignore delete errors */
				});
			}

			return "❌ Failed to get thread content. Please try again.";
		}
	},
};
