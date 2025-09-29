import type { FeedThread, Reply, Thread } from "../api/types.ts";

export function extractTitleFromContent(content: string): string | null {
	if (!content) return null;

	const cleanContent = content
		.replace(/<[^>]*>/g, "")
		.replace(/&[a-zA-Z0-9#]+;/g, "")
		.trim();

	if (!cleanContent) return null;

	let extractedTitle = "";

	if (content.includes("<br />")) {
		extractedTitle = content.split("<br />")[0];
	} else if (content.includes("\n")) {
		extractedTitle = content.split("\n")[0];
	} else {
		extractedTitle = content;
	}

	if (extractedTitle.length > 20) {
		extractedTitle = extractedTitle.substring(0, 20);
	}

	if (!extractedTitle || extractedTitle === "无标题") {
		return null;
	}

	return extractedTitle;
}

export function formatTitle(thread: FeedThread | Thread | Reply): string {
	if (!thread.title || thread.title === "无标题") {
		if (thread.name && thread.name !== "无名氏") {
			return thread.name;
		}

		if (thread.content) {
			const extractedTitle = extractTitleFromContent(thread.content);
			if (extractedTitle) {
				return extractedTitle;
			}
		}

		return `${thread.id}`;
	}

	return thread.title;
}
