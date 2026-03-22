import {
	downloadAndReplaceImages,
	type ImageProgress,
} from "./image-processor.ts";

export type PdfProgress = ImageProgress;

export { downloadAndReplaceImages } from "./image-processor.ts";

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

export async function convertMarkdownToPdf(
	markdown: string,
	title?: string,
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
				"-V",
				`title=${title || "Thread Export"}`,
			],
			stdin: "piped",
			stdout: "piped",
			stderr: "piped",
		});

		console.log("Markdown is ready to be converted to PDF");

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

export async function generatePdf(
	markdown: string,
	title: string,
	onProgress?: (progress: PdfProgress) => void,
): Promise<Uint8Array | null> {
	if (!(await isPandocAvailable())) {
		console.log("Pandoc not available, skipping PDF generation");
		return null;
	}
	console.log("Pandoc available, generating PDF");

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

	return await convertMarkdownToPdf(markdownWithLocalImages, title);
}
