import { exportToTelegraph } from "../../services/telegraph.ts";
import type { CommandDefinition } from "../types.ts";
import { fetchThread } from "./common/fetch-thread.ts";
import { createStatusUpdater } from "./common/status-updater.ts";

export const tg: CommandDefinition = {
	name: "tg",
	description: "Export thread to Telegraph",
	guards: [],
	handler: async ({ ctx }) => {
		const result = await fetchThread(ctx, "Preparing Telegraph export for");
		if (!result) return;

		const { threadId: _threadId, title, filteredMarkdown, statusMsg } = result;
		const chatId = ctx.chat?.id;
		if (!chatId) return undefined;

		const updater = createStatusUpdater(ctx.api, chatId, statusMsg);

		try {
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
					{
						parse_mode: "Markdown",
					},
				);
			}
		} catch (error) {
			console.error("Error in tg command:", error);
			await ctx.reply("❌ Telegraph export failed.");
			await updater?.delete();
		}
		return undefined;
	},
};
