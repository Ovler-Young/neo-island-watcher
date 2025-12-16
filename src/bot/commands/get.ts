import { InputFile } from "grammy";

import { generateEpub } from "../../services/epub-generator.ts";
import { generatePdf } from "../../services/pdf-generator.ts";
import { exportToTelegraph } from "../../services/telegraph.ts";
import { generateThreadFilename } from "../../utils/filename.ts";

import type { CommandDefinition } from "../types.ts";
import { fetchThread } from "./common/fetch-thread.ts";
import { sendDocument } from "./common/file-utils.ts";
import { createStatusUpdater } from "./common/status-updater.ts";

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

		const updater = createStatusUpdater(ctx.api, chatId, statusMsg);

		try {
			// 1. Send Markdown Files
			await updater?.forceUpdate("📝 Sending Markdown files...");

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
			await updater?.forceUpdate("📄 Generating PDF (filtered)...");

			// Filtered PDF
			const filteredPdfBuffer = await generatePdf(
				filteredMarkdown,
				title,
				async (progress) => {
					const phaseText =
						progress.phase === "downloading"
							? `📥 下载图片: ${progress.current}/${progress.total}`
							: "📄 转换中...";
					await updater?.update(phaseText);
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
				await updater?.forceUpdate("📄 Generating PDF (all)...");
				const allPdfBuffer = await generatePdf(
					allMarkdown,
					title,
					async (progress) => {
						const phaseText =
							progress.phase === "downloading"
								? `📥 下载图片 (all): ${progress.current}/${progress.total}`
								: "📄 转换中...";
						await updater?.update(phaseText);
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
			await updater?.forceUpdate("📚 Generating EPUB (filtered)...");

			// Filtered EPUB
			const filteredEpubBuffer = await generateEpub(
				filteredMarkdown,
				title,
				async (progress) => {
					const phaseText =
						progress.phase === "downloading"
							? `📥 下载图片: ${progress.current}/${progress.total}`
							: "📚 转换中...";
					await updater?.update(phaseText);
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
				await updater?.forceUpdate("📚 Generating EPUB (all)...");
				const allEpubBuffer = await generateEpub(
					allMarkdown,
					title,
					async (progress) => {
						const phaseText =
							progress.phase === "downloading"
								? `📥 下载图片 (all): ${progress.current}/${progress.total}`
								: "📚 转换中...";
						await updater?.update(phaseText);
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
			await updater?.forceUpdate("📤 Creating Telegraph pages...");

			const pageUrls = await exportToTelegraph(
				filteredMarkdown,
				title,
				"neo-island-watcher",
				async (progress) => {
					const phaseText =
						progress.phase === "uploading" ? "上传页面" : "刷新页码";
					const availableText =
						progress.availableUrls && progress.availableUrls.length > 0
							? `\n\n可查看页面: ${progress.availableUrls
									.map((url, i) => `[${i + 1}](${url})`)
									.join(", ")}`
							: "";
					await updater?.update(
						`📤 创建 Telegraph 页面...\n${phaseText}: ${progress.current}/${progress.total}${availableText}`,
						{ parse_mode: "Markdown" },
					);
				},
			);

			// Delete status message before sending Telegraph URLs
			await updater?.delete();

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
			await updater?.delete();
		}
		return undefined;
	},
};
