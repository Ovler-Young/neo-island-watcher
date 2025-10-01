import { xdnmbClient } from "../../api/xdnmb.ts";
import type { CommandDefinition } from "../types.ts";

export const reply: CommandDefinition = {
	name: "reply",
	description: "Reply to a thread (use in topic)",
	params: [{ name: "message", type: "string", required: true }],
	guards: ["groupOnly", "threadContext", "cookie"],
	handler: async ({ threadId, cookieData, params }) => {
		const result = await xdnmbClient.postReply(
			threadId,
			params.message as string,
			cookieData.cookie,
		);
		return result.includes("回复成功")
			? "✅ Reply posted successfully!"
			: "❌ Failed to post reply. Please try again.";
	},
};
