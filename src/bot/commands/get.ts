import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { InputFile } from "grammy";
import type { ProgressInfo } from "../../api/types.ts";
import { xdnmbClient } from "../../api/xdnmb.ts";
import { formatThreadAsMarkdown } from "../../services/markdown-formatter.ts";
import { generatePdf } from "../../services/pdf-generator.ts";
import { exportToTelegraph } from "../../services/telegraph.ts";
import { groupBindings } from "../../storage/group-bindings.ts";
import { threadStates } from "../../storage/thread-state.ts";
import { generateThreadFilename } from "../../utils/filename.ts";
import { formatTitle } from "../../utils/title.ts";

const TEMP_DIR = "data/temp";

/**
 * Save buffer to temp file and return the file path.
 * This is used for large files to avoid multipart form issues.
 */
async function saveTempFile(
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
async function cleanupTempFile(filePath: string): Promise<void> {
	try {
		await Deno.remove(filePath);
		console.log(`Cleaned up temp file: ${filePath}`);
	} catch {
		// Ignore cleanup errors
	}
}

import type { CommandDefinition } from "../types.ts";

export const get: CommandDefinition = {
	name: "get",
	description: "Get complete thread content as markdown",
	guards: [],
	handler: async ({ ctx }) => {
		let statusMsg: { message_id: number } | null = null;
		let lastUpdate = 0;
		const chatId = ctx.chat?.id;
		if (!chatId) {
			return "❌ No chat found";
		}

		// 1. Determine Thread ID
		let threadId: string | undefined;

		// Check arguments first
		if (ctx.match) {
			const matchStr = String(ctx.match);
			if (/^\d+$/.test(matchStr)) {
				threadId = matchStr;
			}
		}

		// Fallback to bound topic if no argument
		if (
			!threadId &&
			ctx.chat?.type === "supergroup" &&
			ctx.message?.message_thread_id
		) {
			const boundId = await groupBindings.getThreadIdFromGroup(
				chatId.toString(),
				ctx.message.message_thread_id,
			);
			if (boundId) {
				threadId = boundId.toString();
			}
		}

		if (!threadId) {
			return "❌ Please provide a thread ID (e.g., /get 12345) or use this command in a bound topic.";
		}

		try {
			// Send initial status message
			statusMsg = await ctx.reply(`📥 Fetching thread ${threadId}...`);
			lastUpdate = Date.now();
			console.log(`📥 Started fetching thread ${threadId}`);

			// 2. Get or Create Thread State
			let threadState = await threadStates.getThreadState(threadId);
			let formattedTitle: string | undefined;

			if (threadState) {
				formattedTitle = threadState.title;
			} else {
				// Create temporary state
				try {
					const threadData = await xdnmbClient.getThread(Number(threadId), 1);
					threadState = {
						title: formatTitle(threadData),
						lastReplyCount: 0,
						lastReplyId: 0,
						lastCheck: new Date().toISOString(),
						lastNewReplyAt: new Date().toISOString(),
						writer: [threadData.user_hash],
						bindings: [],
					};
					formattedTitle = threadState.title;
				} catch (e) {
					console.error("Failed to fetch thread info for temp state:", e);
					return "❌ Failed to fetch thread info. Does the thread exist?";
				}
			}

			const { markdown: filteredMarkdown, threadData } =
				await formatThreadAsMarkdown(
					threadId,
					threadState,
					(progress: ProgressInfo) => {
						console.log(
							`Progress callback: page ${progress.current}/${progress.total} (${progress.percentage}%)`,
						);
						const now = Date.now();
						if (
							(now - lastUpdate >= 2000 || progress.percentage === 100) &&
							statusMsg
						) {
							ctx.api
								.editMessageText(
									chatId,
									statusMsg.message_id,
									`📥 Fetching thread ${threadId}... Page ${progress.current}/${progress.total} (${progress.percentage}%)`,
								)
								.then(() => {
									lastUpdate = now;
								})
								.catch((err) => {
									console.error("Failed to update status message:", err);
								});
						}
					},
					formattedTitle,
				);

			// Update status to generating files
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"✅ Generating files...",
				);
			}

			// Create both files
			const encoder = new TextEncoder();
			const title = formattedTitle || threadData.title;

			// Filtered version
			const filteredBuffer = encoder.encode(filteredMarkdown);
			const filteredFilename = generateThreadFilename(
				threadId,
				title,
				"filtered",
			);
			const filteredFile = new InputFile(filteredBuffer, filteredFilename);
			await ctx.replyWithDocument(filteredFile);

			// Generate and send filtered PDF
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"📄 Generating PDF (filtered)...",
				);
			}
			const filteredPdfBuffer = await generatePdf(
				filteredMarkdown,
				async (progress) => {
					if (statusMsg) {
						const phaseText =
							progress.phase === "downloading"
								? `📥 下载图片: ${progress.current}/${progress.total}`
								: "📄 转换中...";
						await ctx.api
							.editMessageText(chatId, statusMsg.message_id, phaseText)
							.catch(() => {});
					}
				},
			);
			if (filteredPdfBuffer) {
				const filteredPdfFilename = generateThreadFilename(
					threadId,
					title,
					"filtered",
					"pdf",
				);
				// Save to temp file to avoid multipart form issues with large buffers
				const tempPath = await saveTempFile(
					filteredPdfBuffer,
					filteredPdfFilename,
				);
				try {
					const fileHandle = await Deno.open(tempPath);
					const filteredPdfFile = new InputFile(
						fileHandle,
						filteredPdfFilename,
					);
					await ctx.replyWithDocument(filteredPdfFile, {
						caption: filteredPdfFilename,
					});
				} finally {
					await cleanupTempFile(tempPath);
				}
			}

			if (!threadState.writer.includes("*")) {
				threadState.writer.push("*");

				const { markdown: allMarkdown } = await formatThreadAsMarkdown(
					threadId,
					threadState,
					undefined,
					formattedTitle,
				);

				console.log(
					`Markdown generated - Filtered: ${filteredMarkdown.length} chars, All: ${allMarkdown.length} chars`,
				);

				const allBuffer = encoder.encode(allMarkdown);
				const allFilename = generateThreadFilename(threadId, title, "all");
				const allFile = new InputFile(allBuffer, allFilename);

				console.log(
					`Sending documents - Filtered: ${filteredFilename}, All: ${allFilename}`,
				);

				await ctx.replyWithDocument(allFile);

				// Generate and send all PDF
				if (statusMsg) {
					await ctx.api.editMessageText(
						chatId,
						statusMsg.message_id,
						"📄 Generating PDF (all)...",
					);
				}
				const allPdfBuffer = await generatePdf(
					allMarkdown,
					async (progress) => {
						if (statusMsg) {
							const phaseText =
								progress.phase === "downloading"
									? `📥 下载图片 (all): ${progress.current}/${progress.total}`
									: "📄 转换中...";
							await ctx.api
								.editMessageText(chatId, statusMsg.message_id, phaseText)
								.catch(() => {});
						}
					},
				);
				if (allPdfBuffer) {
					const allPdfFilename = generateThreadFilename(
						threadId,
						title,
						"all",
						"pdf",
					);
					// Save to temp file to avoid multipart form issues with large buffers
					const tempPath = await saveTempFile(allPdfBuffer, allPdfFilename);
					try {
						const fileHandle = await Deno.open(tempPath);
						const allPdfFile = new InputFile(fileHandle, allPdfFilename);
						await ctx.replyWithDocument(allPdfFile, {
							caption: allPdfFilename,
						});
					} finally {
						await cleanupTempFile(tempPath);
					}
				}
			}

			console.log(`Documents sent successfully for thread ${threadId}`);

			// Export to Telegraph
			try {
				if (statusMsg) {
					await ctx.api.editMessageText(
						chatId,
						statusMsg.message_id,
						"📤 Creating Telegraph pages...",
					);
				}

				console.log(`Starting Telegraph export for thread ${threadId}`);
				const pageUrls = await exportToTelegraph(
					filteredMarkdown,
					title,
					"neo-island-watcher",
					async (progress) => {
						// Update status message with progress
						if (statusMsg) {
							const phaseText =
								progress.phase === "uploading" ? "上传页面" : "刷新页码";
							const availableText =
								progress.availableUrls && progress.availableUrls.length > 0
									? `\n\n可查看页面: ${progress.availableUrls
											.map((url, i) => `[${i + 1}](${url})`)
											.join(", ")}`
									: "";

							await ctx.api
								.editMessageText(
									chatId,
									statusMsg.message_id,
									`📤 创建 Telegraph 页面...\n${phaseText}: ${progress.current}/${progress.total}${availableText}`,
									{ parse_mode: "Markdown" },
								)
								.catch((err) => {
									console.error("Failed to update Telegraph progress:", err);
								});
						}
					},
				);
				console.log(`Telegraph export complete: ${pageUrls.length} page(s)`);

				// Delete status message before sending Telegraph URLs
				if (statusMsg) {
					await ctx.api
						.deleteMessage(chatId, statusMsg.message_id)
						.catch(() => {
							/* Ignore delete errors */
						});
					statusMsg = null;
				}

				// Send Telegraph URL(s)
				if (pageUrls.length === 1) {
					await ctx.reply(`📄 Telegraph: ${pageUrls[0]}`);
				} else {
					const urlList = pageUrls
						.map((url, i) => `[${i + 1}](${url})`)
						.join(", ");
					await ctx.reply(
						`📄 Telegraph (${pageUrls.length} pages):\n${urlList}`,
						{ parse_mode: "Markdown" },
					);
				}
			} catch (telegraphError) {
				console.error(
					`Telegraph export failed for thread ${threadId}:`,
					telegraphError,
				);
				// Non-fatal error, just log it
				await ctx.reply(
					"⚠️ Telegraph export failed, but markdown files were sent successfully.",
				);
			}
			if (statusMsg) {
				await ctx.api.deleteMessage(chatId, statusMsg.message_id);
			}
			return undefined;
		} catch (error) {
			console.error(`Error getting thread ${threadId}:`, error);
			if (error instanceof Error) {
				console.error(`Error message: ${error.message}`);
				console.error(`Error stack: ${error.stack}`);
			}

			// Clean up status message if it exists
			if (statusMsg) {
				await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {
					/* Ignore delete errors */
				});
			}

			return "❌ Failed to get thread content. Please try again.";
		}
	},
};
