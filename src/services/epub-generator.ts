import {
	downloadAndReplaceImages,
	isPandocAvailable,
	type PdfProgress,
} from "./pdf-generator.ts";

export type EpubProgress = PdfProgress;

/**
 * Convert markdown to EPUB using pandoc.
 * Returns the EPUB as a Uint8Array, or null if conversion fails.
 */
export async function convertMarkdownToEpub(
	markdown: string,
): Promise<Uint8Array | null> {
	try {
		const command = new Deno.Command("pandoc", {
			args: [
				"-f",
				"markdown",
				"-t",
				"epub3",
				"--metadata",
				"title=Thread Export", // Default title, pandoc warns if missing
			],
			stdin: "piped",
			stdout: "piped",
			stderr: "piped",
		});

		console.log("Markdown is ready to be converted to EPUB");

		const process = command.spawn();

		// Write markdown to stdin with error handling
		const encoder = new TextEncoder();
		try {
			const writer = process.stdin.getWriter();
			await writer.write(encoder.encode(markdown));
			await writer.close();
		} catch (stdinError) {
			console.error("Failed to write to pandoc stdin:", stdinError);
			return null;
		}

		const { success, stdout, stderr } = await process.output();

		if (!success) {
			const errorText = new TextDecoder().decode(stderr);
			console.error("Pandoc EPUB conversion failed:", errorText);
			return null;
		}

		console.log("Pandoc EPUB conversion has been completed");
		return stdout;
	} catch (error) {
		console.error("Failed to run pandoc for EPUB:", error);
		return null;
	}
}

/**
 * Generate an EPUB from markdown content.
 * Downloads images to local cache and converts to EPUB using pandoc.
 * Returns null if pandoc is not available or conversion fails.
 */
export async function generateEpub(
	markdown: string,
	onProgress?: (progress: EpubProgress) => void,
): Promise<Uint8Array | null> {
	// Check if pandoc is available
	if (!(await isPandocAvailable())) {
		console.log("Pandoc not available, skipping EPUB generation");
		return null;
	}

	// Download images and replace URLs with local paths
	// Re-using the logic from pdf-generator as it does exactly what we need
	const markdownWithLocalImages = await downloadAndReplaceImages(
		markdown,
		onProgress,
		{
			// Fail fast for EPUB images - if we can't get them quickly,
			// we'll just fall back to the remote URL (which is what returning null does)
			retries: 1,
			timeoutMs: 5000,
			fallbackToLink: true,
		},
	);

	// Convert to EPUB
	onProgress?.({
		phase: "converting",
		current: 1,
		total: 1,
	});

	return await convertMarkdownToEpub(markdownWithLocalImages);
}
