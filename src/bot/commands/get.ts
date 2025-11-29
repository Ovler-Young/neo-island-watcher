import { InputFile } from "grammy";
import type { ProgressInfo } from "../../api/types.ts";
import { xdnmbClient } from "../../api/xdnmb.ts";
import { formatThreadAsMarkdown } from "../../services/markdown-formatter.ts";
import { groupBindings } from "../../storage/group-bindings.ts";
import { threadStates } from "../../storage/thread-state.ts";
import { generateThreadFilename } from "../../utils/filename.ts";
import { formatTitle } from "../../utils/title.ts";
import type { CommandDefinition } from "../types.ts";

export const get: CommandDefinition = {
	name: "get",
	description: "Get complete thread content as markdown",
	guards: [],
	handler: async ({ ctx }) => {
		let statusMsg: { message_id: number } | null = null;
		let lastUpdate = 0;
		const chatId = ctx.chat?.id;
		if (!chatId) {
			return "❌ No chat found";
		}

		// 1. Determine Thread ID
		let threadId: string | undefined;

		// Check arguments first
		if (ctx.match) {
			const matchStr = String(ctx.match);
			if (/^\d+$/.test(matchStr)) {
				threadId = matchStr;
			}
		}

		// Fallback to bound topic if no argument
		if (
			!threadId &&
			ctx.chat?.type === "supergroup" &&
			ctx.message?.message_thread_id
		) {
			const boundId = await groupBindings.getThreadIdFromGroup(
				chatId.toString(),
				ctx.message.message_thread_id,
			);
			if (boundId) {
				threadId = boundId.toString();
			}
		}

		if (!threadId) {
			return "❌ Please provide a thread ID (e.g., /get 12345) or use this command in a bound topic.";
		}

		try {
			// Send initial status message
			statusMsg = await ctx.reply(`📥 Fetching thread ${threadId}...`);
			lastUpdate = Date.now();
			console.log(`📥 Started fetching thread ${threadId}`);

			// 2. Get or Create Thread State
			let threadState = await threadStates.getThreadState(threadId);
			let formattedTitle: string | undefined;

			if (threadState) {
				formattedTitle = threadState.title;
			} else {
				// Create temporary state
				try {
					const threadData = await xdnmbClient.getThread(Number(threadId), 1);
					threadState = {
						title: formatTitle(threadData),
						lastReplyCount: 0,
						lastReplyId: 0,
						lastCheck: new Date().toISOString(),
						lastNewReplyAt: new Date().toISOString(),
						writer: [threadData.user_hash],
						bindings: [],
					};
				} catch (e) {
					console.error("Failed to fetch thread info for temp state:", e);
					return "❌ Failed to fetch thread info. Does the thread exist?";
				}
			}

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
							(now - lastUpdate >= 2000 || progress.percentage === 100) &&
							statusMsg
						) {
							ctx.api
								.editMessageText(
									chatId,
									statusMsg.message_id,
									`📥 Fetching thread ${threadId}... Page ${progress.current}/${progress.total} (${progress.percentage}%)`,
								)
								.then(() => {
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
