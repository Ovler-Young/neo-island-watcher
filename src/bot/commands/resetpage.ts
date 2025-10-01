import { threadStates } from "../../storage/thread-state.ts";
import type { CommandDefinition } from "../types.ts";

export const resetpage: CommandDefinition = {
	name: "resetpage",
	description: "Reset page state for a thread",
	params: [
		{ name: "page", type: "number", required: true },
		{ name: "lastReplyId", type: "number", required: false, default: 0 },
	],
	guards: ["groupOnly", "threadContext"],
	handler: async ({ threadId, params }) => {
		const page = params.page as number;
		const lastReplyId = params.lastReplyId as number;

		if (page < 1) {
			return "❌ Page number must be a positive integer.";
		}

		await threadStates.resetPage(threadId, page, lastReplyId);

		const newReplyCount = 19 * (page - 1) + 1;
		return (
			`✅ Thread page reset successfully!\n\n` +
			`📄 Page: ${page}\n` +
			`🔢 Reply count: ${newReplyCount}\n` +
			`🆔 Last reply ID: ${lastReplyId}`
		);
	},
};
