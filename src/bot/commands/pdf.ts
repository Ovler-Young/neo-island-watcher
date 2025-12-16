import { generatePdf } from "../../services/pdf-generator.ts";
import { generateThreadFilename } from "../../utils/filename.ts";
import type { CommandDefinition } from "../types.ts";
import { fetchThread } from "./common/fetch-thread.ts";
import { sendDocument } from "./common/file-utils.ts";

export const pdf: CommandDefinition = {
	name: "pdf",
	description: "Get thread as PDF (filtered & all)",
	guards: [],
	handler: async ({ ctx }) => {
		const result = await fetchThread(ctx, "Generating PDF for");
		if (!result) return;

		const { threadId, title, filteredMarkdown, allMarkdown, statusMsg } =
			result;
		const chatId = ctx.chat?.id;
		if (!chatId) return undefined;

		try {
			// Update status
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"📄 Generating PDF (filtered)...",
				);
			}

			// Generate Filtered PDF
			const filteredPdfBuffer = await generatePdf(
				filteredMarkdown,
				title,
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

			// Generate All PDF if available
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
					title,
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

			if (statusMsg) {
				await ctx.api
					.deleteMessage(chatId, statusMsg.message_id)
					.catch(() => {});
			}
		} catch (error) {
			console.error("Error in pdf command:", error);
			await ctx.reply("❌ Error generating PDF.");
		}
		return undefined;
	},
};
