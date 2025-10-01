import { xdnmbClient } from "../../api/xdnmb.ts";
import type { CommandDefinition } from "../types.ts";

export const r: CommandDefinition = {
	name: "r",
	description: "Roll dice in a thread",
	params: [{ name: "number", type: "number", required: false, default: 10 }],
	guards: ["groupOnly", "threadContext", "cookie"],
	handler: async ({ threadId, cookieData, params }) => {
		const num = params.number as number;
		const diceRange = `[1,${num}]`;
		const result = await xdnmbClient.postReply(
			threadId,
			diceRange,
			cookieData.cookie,
		);
		return result.includes("回复成功")
			? `🎲 Dice rolled: ${diceRange}`
			: "❌ Failed to roll dice. Please try again.";
	},
};
