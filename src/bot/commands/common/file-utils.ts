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
		const chatId = ctx.chat?.id;
		if (!chatId) {
			throw new Error("No chat ID found in context");
		}

		let lastError: unknown;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				const fileHandle = await Deno.open(tempPath);
				const inputFile = new InputFile(fileHandle, filename);
				await ctx.api.sendDocument(chatId, inputFile, {
					caption: caption || filename,
					message_thread_id: ctx.message?.message_thread_id,
				});
				return; // Success, exit function
			} catch (error) {
				lastError = error;
				console.error(`Send document failed (attempt ${attempt}/3):`, error);
				// Wait briefly before retry
				if (attempt < 3) {
					await new Promise((resolve) => setTimeout(resolve, 2000));
				}
			}
		}
		throw lastError; // Re-throw last error if all attempts fail
	} finally {
		await cleanupTempFile(tempPath);
	}
}
