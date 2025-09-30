import type { Message } from "grammy/types";
import { groupBindings } from "../storage/group-bindings.ts";
export async function extractThreadIdFromTopic(ctx: {
	message?: Message;
}): Promise<string | null> {
	if (!ctx.message) {
		return null;
	}

	const message_thread_id = ctx.message.message_thread_id;
	console.log("Extracted message_thread_id:", message_thread_id);
	if (message_thread_id) {
		return (
			(
				await groupBindings.getThreadIdFromGroup(
					ctx.message.chat.id.toString(),
					message_thread_id,
				)
			)?.toString() || null
		);
	}

	return null;
}
