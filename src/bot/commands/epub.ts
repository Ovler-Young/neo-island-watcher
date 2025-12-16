import { generateEpub } from "../../services/epub-generator.ts";
import { generateThreadFilename } from "../../utils/filename.ts";
import type { CommandDefinition } from "../types.ts";
import { fetchThread } from "./common/fetch-thread.ts";
import { sendDocument } from "./common/file-utils.ts";
import { createStatusUpdater } from "./common/status-updater.ts";

export const epub: CommandDefinition = {
	name: "epub",
	description: "Get thread as EPUB (filtered & all)",
	guards: [],
	handler: async ({ ctx }) => {
		const result = await fetchThread(ctx, "Generating EPUB for");
		if (!result) return;

		const { threadId, title, filteredMarkdown, allMarkdown, statusMsg } =
			result;
		const chatId = ctx.chat?.id;
		if (!chatId) return undefined;

		const updater = createStatusUpdater(ctx.api, chatId, statusMsg);

		try {
			// Update status
			await updater?.forceUpdate("📚 Generating EPUB (filtered)...");

			// Generate Filtered EPUB
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

			// Generate All EPUB if available
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

			await updater?.delete();
		} catch (error) {
			console.error("Error in epub command:", error);
			await ctx.reply("❌ Error generating EPUB.");
			await updater?.delete();
		}
		return undefined;
	},
};
