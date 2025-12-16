import { generatePdf } from "../../services/pdf-generator.ts";
import { generateThreadFilename } from "../../utils/filename.ts";
import type { CommandDefinition } from "../types.ts";
import { fetchThread } from "./common/fetch-thread.ts";
import { sendDocument } from "./common/file-utils.ts";
import { createStatusUpdater } from "./common/status-updater.ts";

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

		const updater = createStatusUpdater(ctx.api, chatId, statusMsg);

		try {
			// Update status
			await updater?.forceUpdate("📄 Generating PDF (filtered)...");

			// Generate Filtered PDF
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

			// Generate All PDF if available
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

			await updater?.delete();
		} catch (error) {
			console.error("Error in pdf command:", error);
			await ctx.reply("❌ Error generating PDF.");
			await updater?.delete();
		}
		return undefined;
	},
};
