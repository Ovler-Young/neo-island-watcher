import { InputFile } from "grammy";
import type { ProgressInfo } from "../../api/types.ts";
import { formatThreadAsMarkdown } from "../../services/markdown-formatter.ts";
import { threadStates } from "../../storage/thread-state.ts";
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
			console.log(`📥 Started fetching thread ${threadId}`);

			// Get formatted title from threadStates
			const threadState = await threadStates.getThreadState(threadId);
			if (!threadState) {
				return "❌ Thread not found";
			}
			const formattedTitle = threadState?.title;

			const { markdown: filteredMarkdown, threadData } =
				await formatThreadAsMarkdown(
					threadId,
					threadState,
					(progress: ProgressInfo) => {
						console.log(
							`Progress callback: page ${progress.current}/${progress.total} (${progress.percentage}%)`,
						);
						const now = Date.now();
						if (
							(now - lastUpdate >= 10000 || progress.percentage === 100) &&
							statusMsg
						) {
							ctx.api
								.editMessageText(
									chatId,
									statusMsg.message_id,
									`📥 Fetching thread... Page ${progress.current}/${progress.total} (${progress.percentage}%)`,
								)
								.then(() => {
									console.log("Status message updated successfully");
									lastUpdate = now;
								})
								.catch((err) => {
									console.error("Failed to update status message:", err);
								});
						}
					},
					formattedTitle,
				);

			// Update status to generating files
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"✅ Generating files...",
				);
			}

			// Create both files
			const encoder = new TextEncoder();
			const title = formattedTitle || threadData.title;

			// Filtered version
			const filteredBuffer = encoder.encode(filteredMarkdown);
			const filteredFilename = generateThreadFilename(
				threadId,
				title,
				"filtered",
			);
			const filteredFile = new InputFile(filteredBuffer, filteredFilename);
			await ctx.replyWithDocument(filteredFile);

			if (statusMsg) {
				await ctx.api.deleteMessage(chatId, statusMsg.message_id);
			}

			if (!threadState.writer.includes("*")) {
				const allState = { ...threadState, writer: ["*"] };

				const { markdown: allMarkdown } = await formatThreadAsMarkdown(
					threadId,
					allState,
					undefined,
					formattedTitle,
				);

				console.log(
					`Markdown generated - Filtered: ${filteredMarkdown.length} chars, All: ${allMarkdown.length} chars`,
				);

				const allBuffer = encoder.encode(allMarkdown);
				const allFilename = generateThreadFilename(threadId, title, "all");
				const allFile = new InputFile(allBuffer, allFilename);

				console.log(
					`Sending documents - Filtered: ${filteredFilename}, All: ${allFilename}`,
				);

				await ctx.replyWithDocument(allFile);
			}

			console.log(`Documents sent successfully for thread ${threadId}`);
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
