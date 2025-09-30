import type { FeedThread, Reply } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { config } from "../config.ts";

//* 实际的图片地址由 CDN 地址和 `img`、`ext` 两个字段组合而成。例如：图片 CDN 地址为 `https://image.nmb.best/`，`img` 为 `2022-06-18/62acedc59ef24`，`ext` 为 `.png`，则图片地址为 `https://image.nmb.best/image/2022-06-18/62acedc59ef24.png`，缩略图地址为 `https://image.nmb.best/thumb/2022-06-18/62acedc59ef24.png`。

export async function formatThreadMessage(thread: FeedThread): Promise<string> {
	const threadUrl = xdnmbClient.buildThreadUrl(thread.id.toString());
	const formattedContent = await processContent(thread.content);
	let header = "";
	if (thread.img && thread.ext) {
		const imageUrl = `${config.xdnmbImageBase}/image/${thread.img}${thread.ext}`;
		header += `<a href="${imageUrl}">${thread.img}</a>\n`;
	}

	header += `<a href="${threadUrl}">${thread.id}</a> | #${thread.user_hash}`;
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
	let header = "";
	if (reply.img && reply.ext) {
		const imageUrl = `${config.xdnmbImageBase}/image/${reply.img}${reply.ext}`;
		header += `<a href="${imageUrl}">${reply.img}</a>\n`;
	}

	header += `<a href="${replyUrl}">${reply.id}</a> | #${reply.user_hash}`;
	if (reply.title && reply.title !== "无标题") {
		header += ` | ${reply.title}`;
	}
	if (reply.name && reply.name !== "无名氏") {
		header += ` | ${reply.name}`;
	}
	header += ` | ${reply.now} \n`;

	return header + formattedContent;
}

function escapeHtmlExceptTags(text: string): string {
	// Split text into parts: HTML tags and regular text
	const tagRegex =
		/(<\/?(?:a|spoiler|font|b|small|code|pre|blockquote|i|u|s|strong|em|ins|strike|del|span|tg-spoiler|tg-emoji)(?:\s[^>]*)?>)/gi;
	const parts = text.split(tagRegex);

	// Escape special characters only in non-tag parts
	return parts
		.map((part, index) => {
			// Odd indices are the matched tags (kept as-is)
			if (index % 2 === 1) {
				return part;
			}
			// Even indices are text between tags (escape special chars)
			return part
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
		})
		.join("");
}

async function processContent(content: string): Promise<string> {
	let processed = content;

	// First, decode HTML entities to work with plain text
	processed = processed.replace(/&nbsp;/g, " ");
	processed = processed.replace(/&lt;/g, "<");
	processed = processed.replace(/&gt;/g, ">");
	processed = processed.replace(/&amp;/g, "&");
	processed = processed.replace(/&quot;/g, '"');
	processed = processed.replace(/&#39;/g, "'");

	// Now process >>No. references (after HTML entities are decoded)
	const regex = />>No\.(\d+)/g;
	let matchResult: RegExpExecArray | null;
	let lastIndex = 0;
	const parts: (string | Promise<string>)[] = [];

	while (true) {
		matchResult = regex.exec(processed);
		if (matchResult === null) {
			break;
		}
		parts.push(processed.substring(lastIndex, matchResult.index));
		const postId = matchResult[1];
		const isThread = await xdnmbClient.isThread(parseInt(postId, 10));
		const url = isThread
			? xdnmbClient.buildThreadUrl(postId)
			: xdnmbClient.buildRefUrl(postId);
		parts.push(`<a href="${url}">>No.${postId}</a>`);
		lastIndex = regex.lastIndex;
	}
	parts.push(processed.substring(lastIndex));

	processed = (await Promise.all(parts)).join("");

	processed = processed.replace(
		/<font color="#789922">>([^<]+)<\/font>/g,
		'<font color="#789922">>$1</font>',
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
	processed = processed.replace(/\n{3,}/g, "\n\n");

	// Escape special characters that aren't part of allowed HTML tags
	processed = escapeHtmlExceptTags(processed);

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

/**
 * Splits a long HTML message into chunks that fit within Telegram's message length limit.
 * Preserves HTML formatting by avoiding splits within tags and entities.
 *
 * @param text - The HTML text to split
 * @param maxLength - Maximum length per chunk (default: 4000 to leave room for safety)
 * @returns Array of message chunks
 */
export function splitLongMessage(text: string, maxLength = 4000): string[] {
	if (text.length <= maxLength) {
		return [text];
	}

	const chunks: string[] = [];
	let currentPos = 0;

	while (currentPos < text.length) {
		const chunkEnd = currentPos + maxLength;

		// If this would be the last chunk, take everything
		if (chunkEnd >= text.length) {
			chunks.push(text.slice(currentPos));
			break;
		}

		// Find a safe break point (newline or space) before maxLength
		let breakPoint = text.lastIndexOf("\n", chunkEnd);
		if (breakPoint <= currentPos) {
			breakPoint = text.lastIndexOf(" ", chunkEnd);
		}
		if (breakPoint <= currentPos) {
			breakPoint = chunkEnd;
		}

		// Check if we're inside an HTML tag or entity
		const chunk = text.slice(currentPos, breakPoint);
		const openTags = chunk.match(/<[^>]*$/);
		const openEntity = chunk.match(/&[^;]*$/);

		if (openTags) {
			// We're inside a tag, back up to before it
			const tagStart = chunk.lastIndexOf("<");
			if (tagStart > 0) {
				breakPoint = currentPos + tagStart;
			}
		} else if (openEntity) {
			// We're inside an entity, back up to before it
			const entityStart = chunk.lastIndexOf("&");
			if (entityStart > 0) {
				breakPoint = currentPos + entityStart;
			}
		}

		chunks.push(text.slice(currentPos, breakPoint));
		currentPos = breakPoint;

		// Skip leading whitespace in the next chunk
		while (currentPos < text.length && text[currentPos] === " ") {
			currentPos++;
		}
	}

	return chunks;
}
