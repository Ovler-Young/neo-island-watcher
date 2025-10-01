import { xdnmbClient } from "../../api/xdnmb.ts";
import type { CommandDefinition } from "../types.ts";

export const unsubscribe: CommandDefinition = {
	name: "unsubscribe",
	description: "Unsubscribe from a thread",
	guards: ["groupOnly", "threadContext", "groupBinding"],
	handler: async ({ ctx, threadId }) => {
		const groupId = ctx.chat?.id.toString() ?? "";
		const { groupBindings } = await import("../../storage/group-bindings.ts");
		const groupBinding = await groupBindings.getGroupBinding(groupId);

		const result = await xdnmbClient.delFeed(
			groupBinding?.boundFeeds ?? "",
			threadId,
		);

		return result === "取消订阅成功!"
			? `✅ Unsubscribed from thread ${threadId}!`
			: `❌ Failed to unsubscribe: ${result}`;
	},
};
