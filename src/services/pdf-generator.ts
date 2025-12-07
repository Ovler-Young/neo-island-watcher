import { ensureImageCached } from "../storage/image-cache.ts";

/**
 * PDF generation service using pandoc.
 * Downloads images to local cache and uses file paths for pandoc.
 */

export interface PdfProgress {
	phase: "downloading" | "converting";
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
 * Download all images and replace URLs with local file paths.
 * Returns the modified markdown content.
 */
export async function downloadAndReplaceImages(
	markdown: string,
	onProgress?: (progress: PdfProgress) => void,
): Promise<string> {
	const images = extractImageReferences(markdown);

	console.log(`Found ${images.length} images in markdown`);

	if (images.length === 0) {
		return markdown;
	}

	// Download all images concurrently (with concurrency limit)
	const CONCURRENCY = 5;
	const pathMap = new Map<string, string>();

	console.log(
		`Starting to download ${images.length} images with concurrency ${CONCURRENCY}`,
	);

	for (let i = 0; i < images.length; i += CONCURRENCY) {
		const batch = images.slice(i, i + CONCURRENCY);

		console.log(
			`Processing batch ${Math.floor(i / CONCURRENCY) + 1}, images ${
				i + 1
			} to ${Math.min(i + CONCURRENCY, images.length)}`,
		);

		onProgress?.({
			phase: "downloading",
			current: Math.min(i + CONCURRENCY, images.length),
			total: images.length,
		});

		console.log(`Batch URLs: ${batch.map((img) => img.url).join(", ")}`);

		const results = await Promise.all(
			batch.map(async (img) => {
				console.log(`Downloading image ${img.url}`);
				try {
					const localPath = await ensureImageCached(img.url, img.path);
					console.log(`Downloaded image ${img.url} -> ${localPath}`);
					return { url: img.url, localPath };
				} catch (error) {
					console.error(`Error downloading image ${img.url}:`, error);
					return { url: img.url, localPath: null };
				}
			}),
		);

		console.log(`Downloaded ${results.length} images`);

		for (const result of results) {
			if (result.localPath) {
				pathMap.set(result.url, result.localPath);
			}
		}
	}

	console.log(`Downloaded ${pathMap.size} images`);

	// Replace all image URLs with local file paths
	let result = markdown;
	for (const img of images) {
		const localPath = pathMap.get(img.url);
		if (localPath) {
			result = result.replace(img.fullMatch, `![${img.alt}](${localPath})`);
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
				"--pdf-engine=typst",
				"-V",
				"geometry:margin=1in",
			],
			stdin: "piped",
			stdout: "piped",
			stderr: "piped",
		});

		console.log("Markdown is ready to be converted to PDF");

		const process = command.spawn();

		// Write markdown to stdin
		const encoder = new TextEncoder();
		const writer = process.stdin.getWriter();
		await writer.write(encoder.encode(markdown));
		await writer.close();

		console.log("Markdown has been written to stdin");

		const { success, stdout, stderr } = await process.output();

		console.log("Pandoc conversion has been completed");

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
 * Downloads images to local cache and converts to PDF using pandoc.
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
	} else {
		console.log("Pandoc available, generating PDF");
	}

	// Download images and replace URLs with local paths
	const markdownWithLocalImages = await downloadAndReplaceImages(
		markdown,
		onProgress,
	);

	// Convert to PDF
	onProgress?.({
		phase: "converting",
		current: 1,
		total: 1,
	});

	console.log("Markdown with local images is ready");

	return await convertMarkdownToPdf(markdownWithLocalImages);
}
