import { InputFile } from "grammy";
import { formatThreadAsMarkdown } from "../../services/markdown-formatter.ts";
import type { CommandDefinition } from "../types.ts";

export const get: CommandDefinition = {
	name: "get",
	description: "Get complete thread content as markdown",
	guards: ["groupOnly", "threadContext", "groupBinding"],
	handler: async ({ threadId, ctx }) => {
		try {
			// Format thread as markdown
			const markdown = await formatThreadAsMarkdown(threadId);

			// Create file from markdown content
			const blob = new Blob([markdown], { type: "text/markdown" });
			const file = new InputFile(blob, `thread_${threadId}.md`);

			// Send as document
			await ctx.replyWithDocument(file, {
				caption: `Thread ${threadId} markdown export`,
			});

			return undefined;
		} catch (error) {
			console.error(`Error getting thread ${threadId}:`, error);
			return "❌ Failed to get thread content. Please try again.";
		}
	},
};
