import { jsPDF } from "jspdf";
import type { ThreadData } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { config } from "../config.ts";
import type { ThreadStateData } from "../storage/thread-state.ts";
import { downloadImageAsBase64, getImageFormat } from "../utils/image.ts";
import { shouldSendReply } from "./thread.ts";

const PAGE_WIDTH = 210; // A4 width in mm
const PAGE_HEIGHT = 297; // A4 height in mm
const MARGIN = 15;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const LINE_HEIGHT = 5;
const FONT_SIZE_TITLE = 16;
const FONT_SIZE_HEADER = 10;
const FONT_SIZE_BODY = 9;

/**
 * Decode HTML entities in content for plain text display.
 * Note: This is for PDF text output only, not for HTML rendering.
 * The order of replacements is important: &amp; must be decoded last
 * to avoid double-unescaping issues.
 */
function decodeHtmlEntities(content: string): string {
	let processed = content;
	processed = processed.replace(/&nbsp;/g, " ");
	processed = processed.replace(/&lt;/g, "<");
	processed = processed.replace(/&gt;/g, ">");
	processed = processed.replace(/&quot;/g, '"');
	processed = processed.replace(/&#39;/g, "'");
	// Decode &amp; last to avoid double-unescaping
	processed = processed.replace(/&amp;/g, "&");
	return processed;
}

/**
 * Process content for PDF plain text display.
 * Note: PDF text rendering treats all content as plain text,
 * so HTML tag removal is for visual cleanliness only.
 */
function processContent(content: string): string {
	let processed = content;

	// Decode HTML entities
	processed = decodeHtmlEntities(processed);

	// Remove HTML tags for cleaner plain text output
	processed = processed.replace(/<font color="#789922">>/g, ">");
	processed = processed.replace(/<\/font>/g, "");
	processed = processed.replace(/\[h\]([^[]+)\[\/h\]/g, "[$1]");
	processed = processed.replace(/<b>/g, "");
	processed = processed.replace(/<\/b>/g, "");
	processed = processed.replace(/<small>/g, "");
	processed = processed.replace(/<\/small>/g, "");
	processed = processed.replace(/<br \/>/g, "\n");
	// Remove any remaining HTML tags
	processed = processed.replace(/<[^>]*>/g, "");

	// Clean up excessive newlines
	processed = processed.replace(/\n{3,}/g, "\n\n");

	return processed.trim();
}

/**
 * Progress callback for PDF generation
 */
export type PdfProgressCallback = (update: {
	phase: "downloading" | "rendering";
	current: number;
	total: number;
}) => void | Promise<void>;

/**
 * Generate PDF from thread data with embedded images
 */
export async function generateThreadPdf(
	threadId: string | number,
	threadState: ThreadStateData,
	threadData: ThreadData,
	formattedTitle?: string,
	onProgress?: PdfProgressCallback,
): Promise<Uint8Array> {
	const doc = new jsPDF();
	const title = formattedTitle || threadData.title || `Thread ${threadId}`;

	let y = MARGIN;

	// Collect all images to download
	const imageUrls: string[] = [];

	// Thread image
	if (threadData.img && threadData.ext) {
		imageUrls.push(
			`${config.xdnmbImageBase}/image/${threadData.img}${threadData.ext}`,
		);
	}

	// Reply images
	for (const reply of threadData.Replies) {
		if (shouldSendReply(reply, threadState) && reply.img && reply.ext) {
			imageUrls.push(
				`${config.xdnmbImageBase}/image/${reply.img}${reply.ext}`,
			);
		}
	}

	// Download all images
	const imageCache: Map<string, string> = new Map();
	for (let i = 0; i < imageUrls.length; i++) {
		const url = imageUrls[i];
		await onProgress?.({
			phase: "downloading",
			current: i + 1,
			total: imageUrls.length,
		});

		const base64 = await downloadImageAsBase64(url);
		if (base64) {
			imageCache.set(url, base64);
		}
	}

	// Helper function to add new page if needed
	const checkPageBreak = (requiredHeight: number): void => {
		if (y + requiredHeight > PAGE_HEIGHT - MARGIN) {
			doc.addPage();
			y = MARGIN;
		}
	};

	// Helper function to wrap and add text
	const addWrappedText = (
		text: string,
		fontSize: number,
		maxWidth: number,
	): void => {
		doc.setFontSize(fontSize);
		const lines = doc.splitTextToSize(text, maxWidth);
		const lineHeight = fontSize * 0.4;

		for (const line of lines) {
			checkPageBreak(lineHeight);
			doc.text(line, MARGIN, y);
			y += lineHeight;
		}
	};

	// Helper function to add image
	// Note: Images are scaled to fit within maxWidth/maxHeight bounds
	// This may cause some aspect ratio distortion for non-standard images
	const addImage = (url: string, maxHeight: number = 60): void => {
		const base64 = imageCache.get(url);
		if (!base64) return;

		const format = getImageFormat(url);
		const maxWidth = CONTENT_WIDTH * 0.8;

		checkPageBreak(maxHeight + 5);
		try {
			doc.addImage(base64, format, MARGIN, y, maxWidth, maxHeight);
			y += maxHeight + 5;
		} catch (error) {
			console.error(`Failed to add image to PDF: ${error}`);
		}
	};

	// Helper function to add a separator line
	const addSeparator = (): void => {
		checkPageBreak(LINE_HEIGHT);
		doc.setDrawColor(200, 200, 200);
		doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
		y += LINE_HEIGHT;
	};

	// Render title
	doc.setFont("helvetica", "bold");
	addWrappedText(title, FONT_SIZE_TITLE, CONTENT_WIDTH);
	y += LINE_HEIGHT;

	// Render thread header
	const threadUrl = xdnmbClient.buildThreadUrl(threadData.id.toString());
	let threadHeader = `${threadData.id} | #${threadData.user_hash}`;
	if (threadData.title && threadData.title !== "无标题") {
		threadHeader += ` | ${threadData.title}`;
	}
	if (threadData.name && threadData.name !== "无名氏") {
		threadHeader += ` | ${threadData.name}`;
	}
	threadHeader += ` | ${threadData.now}`;
	threadHeader += `\nURL: ${threadUrl}`;

	doc.setFont("helvetica", "normal");
	addWrappedText(threadHeader, FONT_SIZE_HEADER, CONTENT_WIDTH);
	y += LINE_HEIGHT / 2;

	// Thread image
	if (threadData.img && threadData.ext) {
		const imageUrl = `${config.xdnmbImageBase}/image/${threadData.img}${threadData.ext}`;
		addImage(imageUrl);
	}

	// Thread content
	const threadContent = processContent(threadData.content);
	addWrappedText(threadContent, FONT_SIZE_BODY, CONTENT_WIDTH);
	y += LINE_HEIGHT;

	addSeparator();

	// Render replies
	let renderedCount = 0;
	const totalReplies = threadData.Replies.filter((r) =>
		shouldSendReply(r, threadState),
	).length;

	for (let i = 0; i < threadData.Replies.length; i++) {
		const reply = threadData.Replies[i];

		if (!shouldSendReply(reply, threadState)) {
			continue;
		}

		renderedCount++;
		await onProgress?.({
			phase: "rendering",
			current: renderedCount,
			total: totalReplies,
		});

		// Reply header
		let replyHeader = `${reply.id} | #${reply.user_hash}`;
		if (reply.title && reply.title !== "无标题") {
			replyHeader += ` | ${reply.title}`;
		}
		if (reply.name && reply.name !== "无名氏") {
			replyHeader += ` | ${reply.name}`;
		}
		replyHeader += ` | ${reply.now}`;

		addWrappedText(replyHeader, FONT_SIZE_HEADER, CONTENT_WIDTH);

		// Reply image
		if (reply.img && reply.ext) {
			const imageUrl = `${config.xdnmbImageBase}/image/${reply.img}${reply.ext}`;
			addImage(imageUrl);
		}

		// Reply content
		const replyContent = processContent(reply.content);
		addWrappedText(replyContent, FONT_SIZE_BODY, CONTENT_WIDTH);
		y += LINE_HEIGHT / 2;

		addSeparator();
	}

	// Return PDF as Uint8Array
	const pdfOutput = doc.output("arraybuffer");
	return new Uint8Array(pdfOutput);
}
