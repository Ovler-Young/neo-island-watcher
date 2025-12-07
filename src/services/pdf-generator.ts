import { getImageAsBase64 } from "../storage/image-cache.ts";

/**
 * PDF generation service using pandoc.
 * Embeds images as base64 data URIs and converts markdown to PDF.
 */

export interface PdfProgress {
	phase: "embedding" | "converting";
	current: number;
	total: number;
}

/**
 * Check if pandoc is available on the system.
 */
export async function isPandocAvailable(): Promise<boolean> {
	try {
		const command = new Deno.Command("pandoc", {
			args: ["--version"],
			stdout: "null",
			stderr: "null",
		});
		const { success } = await command.output();
		return success;
	} catch {
		return false;
	}
}

/**
 * Extract all image references from markdown content.
 * Returns array of { fullMatch, alt, url, path } objects.
 */
function extractImageReferences(
	markdown: string,
): Array<{ fullMatch: string; alt: string; url: string; path: string }> {
	const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
	const images: Array<{
		fullMatch: string;
		alt: string;
		url: string;
		path: string;
	}> = [];

	for (const match of markdown.matchAll(imageRegex)) {
		const [fullMatch, alt, url] = match;
		// Extract path from URL (e.g., https://image.nmb.best/image/abc.jpg -> /image/abc.jpg)
		try {
			const urlObj = new URL(url);
			images.push({
				fullMatch,
				alt,
				url,
				path: urlObj.pathname,
			});
		} catch {
			// Skip invalid URLs
			console.warn(`Invalid image URL in markdown: ${url}`);
		}
	}

	return images;
}

/**
 * Embed all images in markdown as base64 data URIs.
 * Returns the modified markdown content.
 */
export async function embedImagesAsBase64(
	markdown: string,
	onProgress?: (progress: PdfProgress) => void,
): Promise<string> {
	const images = extractImageReferences(markdown);

	if (images.length === 0) {
		return markdown;
	}

	// Fetch all images concurrently (with concurrency limit)
	const CONCURRENCY = 5;
	const base64Map = new Map<string, string>();

	for (let i = 0; i < images.length; i += CONCURRENCY) {
		const batch = images.slice(i, i + CONCURRENCY);

		onProgress?.({
			phase: "embedding",
			current: Math.min(i + CONCURRENCY, images.length),
			total: images.length,
		});

		const results = await Promise.all(
			batch.map(async (img) => {
				const base64 = await getImageAsBase64(img.url, img.path);
				return { url: img.url, base64 };
			}),
		);

		for (const result of results) {
			if (result.base64) {
				base64Map.set(result.url, result.base64);
			}
		}
	}

	// Replace all image URLs with base64 data URIs
	let result = markdown;
	for (const img of images) {
		const base64 = base64Map.get(img.url);
		if (base64) {
			result = result.replace(img.fullMatch, `![${img.alt}](${base64})`);
		}
	}

	return result;
}

/**
 * Convert markdown to PDF using pandoc.
 * Returns the PDF as a Uint8Array, or null if conversion fails.
 */
export async function convertMarkdownToPdf(
	markdown: string,
): Promise<Uint8Array | null> {
	try {
		const command = new Deno.Command("pandoc", {
			args: [
				"-f",
				"markdown",
				"-t",
				"pdf",
				"--pdf-engine=xelatex",
				"-V",
				"CJKmainfont=Noto Sans CJK SC",
				"-V",
				"geometry:margin=1in",
			],
			stdin: "piped",
			stdout: "piped",
			stderr: "piped",
		});

		const process = command.spawn();

		// Write markdown to stdin
		const encoder = new TextEncoder();
		const writer = process.stdin.getWriter();
		await writer.write(encoder.encode(markdown));
		await writer.close();

		const { success, stdout, stderr } = await process.output();

		if (!success) {
			const errorText = new TextDecoder().decode(stderr);
			console.error("Pandoc conversion failed:", errorText);
			return null;
		}

		return stdout;
	} catch (error) {
		console.error("Failed to run pandoc:", error);
		return null;
	}
}

/**
 * Generate a PDF from markdown content.
 * Embeds images as base64 and converts to PDF using pandoc.
 * Returns null if pandoc is not available or conversion fails.
 */
export async function generatePdf(
	markdown: string,
	onProgress?: (progress: PdfProgress) => void,
): Promise<Uint8Array | null> {
	// Check if pandoc is available
	if (!(await isPandocAvailable())) {
		console.log("Pandoc not available, skipping PDF generation");
		return null;
	}

	// Embed images as base64
	const markdownWithImages = await embedImagesAsBase64(markdown, onProgress);

	// Convert to PDF
	onProgress?.({
		phase: "converting",
		current: 1,
		total: 1,
	});

	return await convertMarkdownToPdf(markdownWithImages);
}
