import type { Context } from "grammy";
import type { ProgressInfo } from "../../../api/types.ts";
import { xdnmbClient } from "../../../api/xdnmb.ts";
import { formatThreadAsMarkdown } from "../../../services/markdown-formatter.ts";
import { groupBindings } from "../../../storage/group-bindings.ts";
import type { ThreadStateData } from "../../../storage/thread-state.ts";
import { threadStates } from "../../../storage/thread-state.ts";
import { formatTitle } from "../../../utils/title.ts";

export interface ThreadFetchResult {
	threadId: string;
	title: string;
	threadState: ThreadStateData;
	filteredMarkdown: string;
	allMarkdown?: string;
	statusMsg: { message_id: number } | null;
}

/**
 * Common logic to fetch thread data, handle status messages, and format markdown.
 */
export async function fetchThread(
	ctx: Context,
	statusPrefix: string = "Fetching thread",
): Promise<ThreadFetchResult | null> {
	const chatId = ctx.chat?.id;
	if (!chatId) {
		await ctx.reply("❌ No chat found");
		return null;
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
		await ctx.reply(
			"❌ Please provide a thread ID (e.g., /get 12345) or use this command in a bound topic.",
		);
		return null;
	}

	let statusMsg: { message_id: number } | null = null;
	let lastUpdate = 0;

	try {
		// Send initial status message
		statusMsg = await ctx.reply(`📥 ${statusPrefix} ${threadId}...`);
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
				formattedTitle = threadState.title;
			} catch (e) {
				console.error("Failed to fetch thread info for temp state:", e);
				await ctx.reply(
					"❌ Failed to fetch thread info. Does the thread exist?",
				);
				if (statusMsg) {
					await ctx.api
						.deleteMessage(chatId, statusMsg.message_id)
						.catch(() => {});
				}
				return null;
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
								`📥 ${statusPrefix} ${threadId}... Page ${progress.current}/${progress.total} (${progress.percentage}%)`,
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

		let allMarkdown: string | undefined;
		if (!threadState.writer.includes("*")) {
			// Temporarily add * to writer to fetch all
			const originalWriters = [...threadState.writer];
			threadState.writer.push("*");

			const result = await formatThreadAsMarkdown(
				threadId,
				threadState,
				undefined, // No progress report for the second pass to avoid confusion/spam
				formattedTitle,
			);
			allMarkdown = result.markdown;

			// Restore writers (although we created a temp state or copy, it's safer not to mutate permanent state if we fetched it from DB,
			// but here threadState might be from DB. Wait, getThreadState returns item from DB.
			// Actually, modifying returned object doesn't modify DB unless we save it.
			// But for safety let's just use it as is.
			// Revert the change just in case.
			threadState.writer = originalWriters;
		}

		return {
			threadId,
			title: formattedTitle || threadData.title,
			threadState,
			filteredMarkdown,
			allMarkdown,
			statusMsg,
		};
	} catch (error) {
		console.error(`Error fetching thread ${threadId}:`, error);
		if (statusMsg) {
			await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
		}
		await ctx.reply("❌ Failed to fetch thread content. Please try again.");
		return null;
	}
}
