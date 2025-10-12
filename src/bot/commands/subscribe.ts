import { xdnmbClient } from "../../api/xdnmb.ts";
import { groupCookies } from "../../storage/group-cookies.ts";
import type { CommandDefinition } from "../types.ts";

export const subscribe: CommandDefinition = {
	name: "subscribe",
	description: "Subscribe to a thread",
	guards: ["groupOnly", "groupBinding"],
	handler: async ({ ctx, threadId }) => {
		const groupId = ctx.chat?.id.toString() ?? "";
		const { groupBindings } = await import("../../storage/group-bindings.ts");
		const groupBinding = await groupBindings.getGroupBinding(groupId);

		const result = await xdnmbClient.addFeed(
			groupBinding?.boundFeeds ?? "",
			threadId,
		);
		await groupCookies.updateLastUsed(groupId);

		return result === "订阅大成功→_→"
			? `✅ Subscribed to thread ${threadId}!`
			: `❌ Failed to subscribe: ${result}`;
	},
};
