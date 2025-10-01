import { feedStates } from "../../storage/feed-state.ts";
import { groupBindings } from "../../storage/group-bindings.ts";
import type { CommandDefinition } from "../types.ts";

export const bindfeed: CommandDefinition = {
	name: "bindfeed",
	description: "Bind an XDNMB feed to this group",
	params: [{ name: "feedUuid", type: "string", required: true }],
	guards: ["groupOnly"],
	handler: async ({ ctx, groupId, params }) => {
		const feedUuid = params.feedUuid as string;
		await feedStates.bindGroupToFeed(feedUuid, ctx.chat?.id ?? 0);
		await groupBindings.bindFeedToGroup(groupId, feedUuid);
		return (
			`✅ Feed ${feedUuid} bound to this group!\n\n` +
			"🔄 Starting to monitor threads and create topics..."
		);
	},
};
