import { xdnmbClient } from "../api/xdnmb.ts";
import { config } from "../config.ts";
import { Reply } from "../api/types.ts";

export async function formatThreadMessage(
	threadId: string,
	writer: string,
	title: string,
	time: string,
	content: string,
): Promise<string> {
	const threadUrl = xdnmbClient.buildThreadUrl(threadId);
	const formattedContent = await processContent(content);

	return (
		`<a href="${threadUrl}">${threadId}</a> | #${writer} | ${title} | ${time}\n` +
		formattedContent
	);
}

export async function formatReplyMessage(
	reply: Reply,
	threadId: string,
	page = 1,
): Promise<string> {
	const replyUrl = `${config.xdnmbFrontendBase}/t/${threadId}/page/${page}`;
	const formattedContent = await processContent(reply.content);

	return (
		`<a href="${replyUrl}">${reply.id}</a> | #${reply.user_hash} | ${reply.now}\n` +
		formattedContent
	);
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
