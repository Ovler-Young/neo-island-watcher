import { threadStates } from "../../storage/thread-state.ts";
import type { CommandDefinition } from "../types.ts";

export const all: CommandDefinition = {
	name: "all",
	description: "Notify all users for this thread",
	guards: ["groupOnly", "threadContext", "groupBinding"],
	handler: async ({ threadId }) => {
		await threadStates.setPoUserId(threadId, "*");

		const threadState = await threadStates.getThreadState(threadId);
		const currentPage = threadState
			? Math.floor((threadState.lastReplyCount - 1) / 19) + 1
			: 0;

		let message = "✅ All users will be notified for this thread.";

		if (currentPage > 0) {
			message +=
				"\n\n💡 Tip: Author changed and current page > 0. Consider using /resetpage to reset page.";
		}

		return message;
	},
};
