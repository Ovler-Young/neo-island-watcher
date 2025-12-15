import { downloadAndReplaceImages, isPandocAvailable } from "./pdf-generator.ts";

/**
 * EPUB generation service using pandoc.
 * Reuses image downloading/caching infrastructure from pdf-generator.
 */

export interface EpubProgress {
	phase: "downloading" | "converting";
	current: number;
	total: number;
}

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
				"--to",
				"epub",
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
			console.log("Markdown has been written to stdin");
		} catch (stdinError) {
			console.error("Failed to write to pandoc stdin:", stdinError);
			// Process might have already exited, try to get the error
			try {
				const { stderr } = await process.output();
				const errorText = new TextDecoder().decode(stderr);
				console.error("Pandoc stderr:", errorText);
			} catch {
				// Ignore
			}
			return null;
		}

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
	} else {
		console.log("Pandoc available, generating EPUB");
	}

	// Download images and replace URLs with local paths
	const markdownWithLocalImages = await downloadAndReplaceImages(
		markdown,
		onProgress,
	);

	// Convert to EPUB
	onProgress?.({
		phase: "converting",
		current: 1,
		total: 1,
	});

	console.log("Markdown with local images is ready");

	return await convertMarkdownToEpub(markdownWithLocalImages);
}
