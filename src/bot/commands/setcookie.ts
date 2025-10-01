import { groupCookies } from "../../storage/group-cookies.ts";
import type { CommandDefinition } from "../types.ts";

export const setcookie: CommandDefinition = {
	name: "setcookie",
	description: "Set XDNMB authentication cookie",
	params: [
		{ name: "userId", type: "string", required: true },
		{ name: "cookie", type: "string", required: true },
	],
	guards: ["groupOnly"],
	handler: async ({ groupId, telegramUserId, params }) => {
		await groupCookies.setCookie(
			groupId,
			params.userId as string,
			params.cookie as string,
			telegramUserId,
		);
		return "✅ Cookie set successfully!";
	},
};
