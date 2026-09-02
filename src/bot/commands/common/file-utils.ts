import { ensureDir } from "@std/fs";
import { type Context, InputFile } from "grammy";

const TEMP_DIR = "data/temp";

/** Write bytes to a temporary path that grammY can reopen for each retry. */
async function saveTempFile(
	buffer: Uint8Array,
	filename: string,
): Promise<string> {
	await ensureDir(TEMP_DIR);
	const suffix = filename.includes(".")
		? `.${filename.split(".").at(-1)}`
		: undefined;
	const filePath = await Deno.makeTempFile({
		dir: TEMP_DIR,
		prefix: "document-",
		suffix,
	});
	await Deno.writeFile(filePath, buffer);
	console.log(`Saved temp file: ${filePath} (${buffer.length} bytes)`);
	return filePath;
}

/**
 * Clean up temp file after sending.
 */
async function cleanupTempFile(filePath: string): Promise<void> {
	try {
		await Deno.remove(filePath);
		console.log(`Cleaned up temp file: ${filePath}`);
	} catch {
		// Ignore cleanup errors
	}
}

/** Send buffer contents through a replayable path source and remove that source. */
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

		await sendDocumentFromPath(ctx, tempPath, filename, caption);
	} finally {
		await cleanupTempFile(tempPath);
	}
}

export async function sendDocumentFromPath(
	ctx: Context,
	filePath: string,
	filename: string,
	caption?: string,
): Promise<void> {
	const chatId = ctx.chat?.id;
	if (!chatId) {
		throw new Error("No chat ID found in context");
	}

	const inputFile = new InputFile(filePath, filename);
	await ctx.api.sendDocument(chatId, inputFile, {
		caption: caption || filename,
		message_thread_id: ctx.message?.message_thread_id,
	});
}
