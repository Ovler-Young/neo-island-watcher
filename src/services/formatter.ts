import { xdnmbClient } from "../api/xdnmb.ts";
import { config } from "../config.ts";

export function formatThreadMessage(
	threadId: string,
	writer: string,
	title: string,
	time: string,
	content: string,
): string {
	const threadUrl = xdnmbClient.buildThreadUrl(threadId);
	const formattedContent = processContent(content);

	return (
		`<a href="${threadUrl}">${threadId}</a> | #${writer} | ${title} | ${time}\n` +
		formattedContent
	);
}

export function formatReplyMessage(
	replyId: string,
	threadId: string,
	writer: string,
	time: string,
	content: string,
	page = 1,
): string {
	const replyUrl = `${config.xdnmbFrontendBase}/t/${threadId}/page/${page}`;
	const formattedContent = processContent(content);

	return (
		`<a href="${replyUrl}">${replyId}</a> | #${writer} | ${time}\n` +
		formattedContent
	);
}

function processContent(content: string): string {
	let processed = content;

	processed = processed.replace(/&gt;&gt;No\.(\d+)/g, (_match, postId) => {
		const refUrl = xdnmbClient.buildRefUrl(postId);
		return `<a href="${refUrl}">&gt;&gt;No.${postId}</a>`;
	});

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
