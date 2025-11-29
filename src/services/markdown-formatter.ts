import type { ProgressInfo, Reply, ThreadData } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { config } from "../config.ts";

// Process content by cleaning HTML tags
const processContent = (content: string): string => {
	let processed = content
		.replace(/<font color="#789922">&gt;&gt;/g, ">>")
		.replace(/<\/font><br \/>/g, "\n")
		.replace(/<\/font>/g, "\n")
		.replace(/<br \/>\r\n/g, "\n")
		.replace(/<br \/>\n/g, "\n");

	processed = processed
		.replace(/<b>/g, "**")
		.replace(/<\/b>/g, "**")
		.replace(/<small>/g, "`")
		.replace(/<\/small>/g, "`");

	return processed;
};

// Format thread header
const formatThreadHeader = (thread: ThreadData): string => {
	let header = "";
	if (thread.title && thread.title !== "无标题") {
		header += `# ${thread.title}\n\n`;
	} else {
		header += `# ${thread.id}\n\n`;
	}
	if (thread.name && thread.name !== "无名氏") {
		header += `**${thread.name}**\n\n`;
	}
	header += `No.${thread.id}  ${thread.user_hash}  ${thread.now}\n`;
	if (thread.img) {
		const imageBaseUrl = `${config.xdnmbFrontendBase}/image`;
		header += `![image](${imageBaseUrl}/${thread.img}${thread.ext})\n`;
	}
	return header;
};

// Format reply
const formatReply = (reply: Reply, isPo: boolean): string => {
	let replyText = "";
	const headerLevel = isPo ? "##" : "###";

	if (reply.title && reply.title !== "无标题") {
		replyText += `\n${headerLevel} ${reply.title}\n\n`;
	} else {
		replyText += `\n${headerLevel} No.${reply.id}\n\n`;
	}

	if (reply.name && reply.name !== "无名氏") {
		replyText += `**${reply.name}**\n`;
	}

	replyText += `${reply.user_hash}  ${reply.now}  No.${reply.id}\n`;

	if (reply.img) {
		const imageBaseUrl = `${config.xdnmbFrontendBase}/image`;
		replyText += `![image](${imageBaseUrl}/${reply.img}${reply.ext})\n`;
	}

	replyText += `${processContent(reply.content)}\n`;
	return replyText;
};

export async function formatThreadAsMarkdown(
	threadId: string | number,
	onProgress?: (progress: ProgressInfo) => void,
): Promise<{ markdown: string; threadData: ThreadData }> {
	// 1. Fetch all data
	const threadData = await xdnmbClient.getFullThread(
		Number(threadId),
		onProgress,
	);

	// 2. Format synchronously
	let content = "";

	// Add thread header and content
	content += formatThreadHeader(threadData);
	content += `${processContent(threadData.content)}\n`;

	// Process replies
	// We assume the thread starter is the PO.
	// If we wanted to support multiple POs (like from a file), we would need that data.
	// For now, we just use the thread starter's hash.
	const poIds = new Set<string>();
	poIds.add(threadData.user_hash);

	for (const reply of threadData.Replies) {
		const isPo = poIds.has(reply.user_hash);
		content += formatReply(reply, isPo);
	}

	// no single \n
	content = content.replace(/\n/g, "\n\n");
	// Clean up excessive newlines
	content = content.replace(/\n{3,}/g, "\n\n");

	return { markdown: content, threadData };
}
