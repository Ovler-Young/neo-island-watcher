import { feedStates } from "../../storage/feed-state.ts";
import { groupBindings } from "../../storage/group-bindings.ts";
import type { CommandDefinition } from "../types.ts";

export const unbindfeed: CommandDefinition = {
	name: "unbindfeed",
	description: "Unbind feed from this group",
	params: [{ name: "feedUuid", type: "string", required: true }],
	guards: ["groupOnly", "groupBinding"],
	handler: async ({ ctx, groupId, params }) => {
		const feedUuid = params.feedUuid as string;
		await feedStates.unbindGroupFromFeed(feedUuid, ctx.chat?.id ?? 0);
		await groupBindings.unbindFeedFromGroup(groupId);
		return `✅ Feed ${feedUuid} unbound from this group!`;
	},
};
