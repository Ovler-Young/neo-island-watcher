import type { FeedThread, Reply } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { config } from "../config.ts";

export async function formatThreadMessage(thread: FeedThread): Promise<string> {
	const threadUrl = xdnmbClient.buildThreadUrl(thread.id.toString());
	const formattedContent = await processContent(thread.content);

	let header = `<a href="${threadUrl}">${thread.id}</a> | #${thread.user_hash}`;
	if (thread.title && thread.title !== "无标题") {
		header += ` | ${thread.title}`;
	}
	if (thread.name && thread.name !== "无名氏") {
		header += ` | ${thread.name}`;
	}
	header += ` | ${thread.now} \n`;

	return header + formattedContent;
}

export async function formatReplyMessage(
	reply: Reply,
	threadId: string,
	page = 1,
): Promise<string> {
	const replyUrl = `${config.xdnmbFrontendBase}/t/${threadId}/page/${page}`;
	const formattedContent = await processContent(reply.content);

	let header = `<a href="${replyUrl}">${reply.id}</a> | #${reply.user_hash}`;
	if (reply.title && reply.title !== "无标题") {
		header += ` | ${reply.title}`;
	}
	if (reply.name && reply.name !== "无名氏") {
		header += ` | ${reply.name}`;
	}
	header += ` | ${reply.now} \n`;

	return header + formattedContent;
}

async function processContent(content: string): Promise<string> {
	let processed = content;

	const regex = /&gt;&gt;No\.(\d+)/g;
	let matchResult: RegExpExecArray | null; // Explicitly type matchResult
	let lastIndex = 0;
	const parts: (string | Promise<string>)[] = [];

	// Refactor while loop to avoid assignment in expression
	while (true) {
		matchResult = regex.exec(processed);
		if (matchResult === null) {
			break;
		}
		parts.push(processed.substring(lastIndex, matchResult.index));
		const postId = matchResult[1];
		const isThread = await xdnmbClient.isThread(parseInt(postId, 10)); // Add radix
		const url = isThread
			? xdnmbClient.buildThreadUrl(postId)
			: xdnmbClient.buildRefUrl(postId);
		parts.push(`<a href="${url}">&gt;&gt;No.${postId}</a>`);
		lastIndex = regex.lastIndex;
	}
	parts.push(processed.substring(lastIndex));

	processed = (await Promise.all(parts)).join("");

	processed = processed.replace(
		/<font color="#789922">&gt;([^<]+)<\/font>/g,
		'<font color="#789922">&gt;$1</font>',
	);

	processed = processed.replace(
		/\[h\]([^[]+)\[\/h\]/g,
		"<spoiler>$1</spoiler>",
	);

	processed = processed.replace(
		/<b>(\d+)<\/b><small>\[([^\]]+)\]<\/small>/g,
		"<b>$1</b><small>[$2]</small>",
	);

	processed = processed.replace(/<br \/>/g, "\n");
	processed = processed.replace(/<[^>]+>/g, "");
	processed = processed.replace(/&nbsp;/g, " ");
	processed = processed.replace(/&lt;/g, "<");
	processed = processed.replace(/&gt;/g, ">");
	processed = processed.replace(/&amp;/g, "&");
	processed = processed.replace(/&quot;/g, '"');
	processed = processed.replace(/&#39;/g, "'");
	processed = processed.trim();

	return processed;
}

export function extractImageUrl(img: string, ext: string): string | null {
	if (!img || !ext) {
		return null;
	}

	return `${config.xdnmbFrontendBase}/image/${img}${ext}`;
}

export function extractThumbnailUrl(img: string, ext: string): string | null {
	if (!img || !ext) {
		return null;
	}

	return `${config.xdnmbFrontendBase}/thumb/${img}${ext}`;
}
