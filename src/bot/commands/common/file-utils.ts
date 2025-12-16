import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { type Context, InputFile } from "grammy";

const TEMP_DIR = "data/temp";

/**
 * Save buffer to temp file and return the file path.
 * This is used for large files to avoid multipart form issues.
 */
export async function saveTempFile(
	buffer: Uint8Array,
	filename: string,
): Promise<string> {
	await ensureDir(TEMP_DIR);
	const filePath = join(TEMP_DIR, filename);
	await Deno.writeFile(filePath, buffer);
	console.log(`Saved temp file: ${filePath} (${buffer.length} bytes)`);
	return filePath;
}

/**
 * Clean up temp file after sending.
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
	try {
		await Deno.remove(filePath);
		console.log(`Cleaned up temp file: ${filePath}`);
	} catch {
		// Ignore cleanup errors
	}
}

/**
 * Helper to save buffer to temp file, send it, and then clean up.
 */
export async function sendDocument(
	ctx: Context,
	buffer: Uint8Array,
	filename: string,
	caption?: string,
) {
	const tempPath = await saveTempFile(buffer, filename);
	try {
		const fileHandle = await Deno.open(tempPath);
		const inputFile = new InputFile(fileHandle, filename);
		await ctx.replyWithDocument(inputFile, {
			caption: caption || filename,
		});
	} finally {
		await cleanupTempFile(tempPath);
	}
}
