import { InputFile } from "grammy";
import { formatThreadAsMarkdown } from "../../services/markdown-formatter.ts";
import type { CommandDefinition } from "../types.ts";

export const get: CommandDefinition = {
	name: "get",
	description: "Get complete thread content as markdown",
	guards: ["groupOnly", "threadContext", "groupBinding"],
	handler: async ({ threadId, ctx }) => {
		try {
			console.log(`Starting markdown export for thread ${threadId}`);

			// Format thread as markdown
			const markdown = await formatThreadAsMarkdown(threadId);
			console.log(`Markdown generated, length: ${markdown.length} chars`);

			// Create file from markdown content using Uint8Array buffer
			const encoder = new TextEncoder();
			const buffer = encoder.encode(markdown);
			const file = new InputFile(buffer, `thread_${threadId}.md`);

			console.log(`Sending document file for thread ${threadId}`);

			// Send as document
			await ctx.replyWithDocument(file, {
				caption: `Thread ${threadId} markdown export`,
			});

			console.log(`Document sent successfully for thread ${threadId}`);
			return undefined;
		} catch (error) {
			console.error(`Error getting thread ${threadId}:`, error);
			if (error instanceof Error) {
				console.error(`Error message: ${error.message}`);
				console.error(`Error stack: ${error.stack}`);
			}
			return "❌ Failed to get thread content. Please try again.";
		}
	},
};
