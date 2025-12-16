import { generateEpub } from "../../services/epub-generator.ts";
import { generateThreadFilename } from "../../utils/filename.ts";
import type { CommandDefinition } from "../types.ts";
import { fetchThread } from "./common/fetch-thread.ts";
import { sendDocument } from "./common/file-utils.ts";

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

		try {
			// Update status
			if (statusMsg) {
				await ctx.api.editMessageText(
					chatId,
					statusMsg.message_id,
					"📚 Generating EPUB (filtered)...",
				);
			}

			// Generate Filtered EPUB
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

			// Generate All EPUB if available
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

			if (statusMsg) {
				await ctx.api
					.deleteMessage(chatId, statusMsg.message_id)
					.catch(() => {});
			}
		} catch (error) {
			console.error("Error in epub command:", error);
			await ctx.reply("❌ Error generating EPUB.");
		}
		return undefined;
	},
};
