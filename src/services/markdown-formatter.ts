import type { ProgressCallback, ThreadData } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { config } from "../config.ts";
import { formatReplyMessage, formatThreadMessage } from "./formatter.ts";

/**
 * Converts HTML anchor tags to markdown link format
 * <a href="url">text</a> -> [text](url)
 */
function convertHtmlLinksToMarkdown(html: string): string {
	return html.replace(/<a href="([^"]+)">([^<]+)<\/a>/g, "[$2]($1)");
}

/**
 * Formats a complete thread as a markdown document
 * @param threadId - The thread ID to fetch and format
 * @param onProgress - Optional callback for progress updates
 * @returns Object containing markdown string and thread data
 */
export async function formatThreadAsMarkdown(
	threadId: string,
	onProgress?: ProgressCallback,
): Promise<{ markdown: string; threadData: ThreadData }> {
	const threadData: ThreadData = await xdnmbClient.getFullThread(
		Number.parseInt(threadId, 10),
		onProgress,
	);

	const messages: string[] = [];

	// Original post - convert ThreadData to FeedThread format
	const threadAsFeed = {
		id: threadData.id.toString(),
		fid: threadData.fid.toString(),
		img: threadData.img,
		ext: threadData.ext,
		now: threadData.now,
		user_hash: threadData.user_hash,
		name: threadData.name,
		email: "",
		title: threadData.title,
		content: threadData.content,
		admin: threadData.admin.toString(),
	};
	const threadMessage = await formatThreadMessage(threadAsFeed);
	messages.push(convertHtmlLinksToMarkdown(threadMessage));

	// Add image in markdown format if exists
	if (threadData.img && threadData.ext) {
		const imageUrl = `${config.xdnmbImageBase}/image/${threadData.img}${threadData.ext}`;
		messages.push(`![${threadData.img}](${imageUrl})`);
	}

	// Replies - use same format as existing HTML
	if (threadData.Replies && threadData.Replies.length > 0) {
		for (const reply of threadData.Replies) {
			const replyMessage = await formatReplyMessage(reply, threadId);
			messages.push(convertHtmlLinksToMarkdown(replyMessage));

			// Add image in markdown format if exists
			if (reply.img && reply.ext) {
				const imageUrl = `${config.xdnmbImageBase}/image/${reply.img}${reply.ext}`;
				messages.push(`![${reply.img}](${imageUrl})`);
			}
		}
	}

	return {
		markdown: messages.join("\n\n---\n"),
		threadData,
	};
}
