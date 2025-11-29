import type { ProgressInfo, Reply, ThreadData } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { config } from "../config.ts";
import type { ThreadStateData } from "../storage/thread-state.ts";
import { shouldSendReply } from "./thread.ts";

// Fast synchronous content processing for markdown
function processContentFast(content: string): string {
	let processed = content;

	// Decode HTML entities
	processed = processed.replace(/&nbsp;/g, " ");
	processed = processed.replace(/&lt;/g, "<");
	processed = processed.replace(/&gt;/g, ">");
	processed = processed.replace(/&amp;/g, "&");
	processed = processed.replace(/&quot;/g, '"');
	processed = processed.replace(/&#39;/g, "'");

	// Convert >>No. references to links (assume all are refs, not threads for speed)
	processed = processed.replace(/>>No\.(\d+)/g, (_, postId) => {
		const url = xdnmbClient.buildRefUrl(postId);
		return `[>>No.${postId}](${url})`;
	});

	// Remove green text font tags
	processed = processed.replace(/<font color="#789922">>/g, ">");
	processed = processed.replace(/<\/font>/g, "");

	// Convert spoiler tags
	processed = processed.replace(/\[h\]([^[]+)\[\/h\]/g, "||$1||");

	// Remove bold and small tags (already processed by API)
	processed = processed.replace(/<b>/g, "");
	processed = processed.replace(/<\/b>/g, "");
	processed = processed.replace(/<small>/g, "");
	processed = processed.replace(/<\/small>/g, "");

	// Convert line breaks
	processed = processed.replace(/<br \/>/g, "\n");

	// Remove any remaining HTML tags
	processed = processed.replace(/<[^>]+>/g, "");

	// Clean up excessive newlines
	processed = processed.replace(/\n{3,}/g, "\n\n");

	return processed;
}

// Format thread message for markdown
function formatThreadMessageMarkdown(thread: ThreadData): string {
	const threadUrl = xdnmbClient.buildThreadUrl(thread.id.toString());
	const formattedContent = processContentFast(thread.content);
	let header = "";

	header += `[${thread.id}](${threadUrl}) | #${thread.user_hash}`;
	if (thread.title && thread.title !== "无标题") {
		header += ` | ${thread.title}`;
	}
	if (thread.name && thread.name !== "无名氏") {
		header += ` | ${thread.name}`;
	}
	header += ` | ${thread.now}\n`;

	return header + formattedContent;
}

// Format reply message for markdown
function formatReplyMessageMarkdown(
	reply: Reply,
	threadId: string,
	page: number,
): string {
	const replyUrl = `${config.xdnmbFrontendBase}/t/${threadId}/page/${page}`;
	const formattedContent = processContentFast(reply.content);
	let header = "";

	header += `[${reply.id}](${replyUrl}) | #${reply.user_hash}`;
	if (reply.title && reply.title !== "无标题") {
		header += ` | ${reply.title}`;
	}
	if (reply.name && reply.name !== "无名氏") {
		header += ` | ${reply.name}`;
	}
	header += ` | ${reply.now}\n`;

	return header + formattedContent;
}

export async function formatThreadAsMarkdown(
	threadId: string | number,
	threadState: ThreadStateData,
	onProgress?: (progress: ProgressInfo) => void,
	formattedTitle?: string,
): Promise<{
	markdown: string;
	threadData: ThreadData;
}> {
	const normalizedThreadId = Number(threadId);
	const threadIdStr = normalizedThreadId.toString();

	// 1. Fetch all data
	const threadData = await xdnmbClient.getFullThread(
		normalizedThreadId,
		onProgress,
	);

	// 2. Use formatted title if provided
	if (formattedTitle) {
		threadData.title = formattedTitle;
	}

	// 3. Format thread header
	let content = `# ${threadData.title}\n\n`;

	content += formatThreadMessageMarkdown(threadData);
	content += "\n\n---\n\n";
	// Process replies
	const repliesPerPage = 19;
	for (let i = 0; i < threadData.Replies.length; i++) {
		const reply = threadData.Replies[i];
		const page = Math.floor(i / repliesPerPage) + 1;

		if (shouldSendReply(reply, threadState)) {
			content += formatReplyMessageMarkdown(reply, threadIdStr, page);
			content += "\n\n---\n\n";
		}
	}

	return {
		markdown: content,
		threadData,
	};
}
