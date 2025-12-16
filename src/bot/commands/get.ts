import { InputFile } from "grammy";

import { generateEpub } from "../../services/epub-generator.ts";
import { generatePdf } from "../../services/pdf-generator.ts";
import { exportToTelegraph } from "../../services/telegraph.ts";
import { generateThreadFilename } from "../../utils/filename.ts";

import type { CommandDefinition } from "../types.ts";
import { fetchThread } from "./common/fetch-thread.ts";
import { sendDocument } from "./common/file-utils.ts";

export const get: CommandDefinition = {
	name: "get",
	description: "Get complete thread content (MD, PDF, EPUB, Telegraph)",
	guards: [],
	handler: async ({ ctx }) => {
		const result = await fetchThread(ctx, "Getting thread");
		if (!result) return;

		const { threadId, title, filteredMarkdown, allMarkdown, statusMsg } =
			result;
		const chatId = ctx.chat?.id;
		if (!chatId) return undefined;
		const encoder = new TextEncoder();

		try {
			// 1. Send Markdown Files
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"📝 Sending Markdown files...",
				);
			}

			// Filtered Markdown
			const filteredBuffer = encoder.encode(filteredMarkdown);
			const filteredFilename = generateThreadFilename(
				threadId,
				title,
				"filtered",
			);
			const filteredFile = new InputFile(filteredBuffer, filteredFilename);
			await ctx.replyWithDocument(filteredFile);

			// All Markdown
			if (allMarkdown) {
				const allBuffer = encoder.encode(allMarkdown);
				const allFilename = generateThreadFilename(threadId, title, "all");
				const allFile = new InputFile(allBuffer, allFilename);
				await ctx.replyWithDocument(allFile);
			}

			// 2. Generate and Send PDF
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"📄 Generating PDF (filtered)...",
				);
			}

			// Filtered PDF
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
				const filename = generateThreadFilename(
					threadId,
					title,
					"filtered",
					"pdf",
				);
				await sendDocument(ctx, filteredPdfBuffer, filename);
			}

			// All PDF
			if (allMarkdown) {
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
					const filename = generateThreadFilename(
						threadId,
						title,
						"all",
						"pdf",
					);
					await sendDocument(ctx, allPdfBuffer, filename);
				}
			}

			// 3. Generate and Send EPUB
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"📚 Generating EPUB (filtered)...",
				);
			}

			// Filtered EPUB
			const filteredEpubBuffer = await generateEpub(
				filteredMarkdown,
				async (progress) => {
					if (statusMsg) {
						const phaseText =
							progress.phase === "downloading"
								? `📥 下载图片: ${progress.current}/${progress.total}`
								: "📚 转换中...";
						await ctx.api
							.editMessageText(chatId, statusMsg.message_id, phaseText)
							.catch(() => {});
					}
				},
			);

			if (filteredEpubBuffer) {
				const filename = generateThreadFilename(
					threadId,
					title,
					"filtered",
					"epub",
				);
				await sendDocument(ctx, filteredEpubBuffer, filename);
			}

			// All EPUB
			if (allMarkdown) {
				if (statusMsg) {
					await ctx.api.editMessageText(
						chatId,
						statusMsg.message_id,
						"📚 Generating EPUB (all)...",
					);
				}
				const allEpubBuffer = await generateEpub(
					allMarkdown,
					async (progress) => {
						if (statusMsg) {
							const phaseText =
								progress.phase === "downloading"
									? `📥 下载图片 (all): ${progress.current}/${progress.total}`
									: "📚 转换中...";
							await ctx.api
								.editMessageText(chatId, statusMsg.message_id, phaseText)
								.catch(() => {});
						}
					},
				);
				if (allEpubBuffer) {
					const filename = generateThreadFilename(
						threadId,
						title,
						"all",
						"epub",
					);
					await sendDocument(ctx, allEpubBuffer, filename);
				}
			}

			// 4. Telegraph Export
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"📤 Creating Telegraph pages...",
				);
			}

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

			// Delete status message before sending Telegraph URLs
			if (statusMsg) {
				await ctx.api
					.deleteMessage(chatId, statusMsg.message_id)
					.catch(() => {});
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
		} catch (error) {
			console.error("Error in get command:", error);
			await ctx.reply(
				"❌ Error processing request. Some files might be missing.",
			);
			if (statusMsg) {
				await ctx.api
					.deleteMessage(chatId, statusMsg.message_id)
					.catch(() => {});
			}
		}
		return undefined;
	},
};
