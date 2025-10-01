import { bot } from "../bot/bot.ts";
import { groupBindings } from "../storage/group-bindings.ts";
import { threadStates } from "../storage/thread-state.ts";

export async function handleRemovedThread(
	threadId: string,
	feedUuid: string,
): Promise<void> {
	try {
		const threadState = await threadStates.getThreadState(threadId);
		if (!threadState) {
			console.log(`Thread ${threadId} not found in state, skipping cleanup`);
			return;
		}

		const bindingsForFeed = threadState.bindings.filter(
			(b) => b.feedUuid === feedUuid,
		);

		for (const binding of bindingsForFeed) {
			try {
				await bot.api.sendMessage(
					binding.groupId,
					`🗑️ 串 ${threadId} 已从订阅消失，已自动退订\n标题：${threadState.title}`,
					{
						message_thread_id: binding.topicId,
					},
				);
			} catch (error) {
				console.error(
					`Failed to send unsubscribe notification for thread ${threadId} to group ${binding.groupId}:`,
					error,
				);
			}

			await groupBindings.removeTopicFromGroup(
				binding.groupId.toString(),
				threadId,
			);
		}

		await threadStates.removeBinding(threadId, bindingsForFeed[0]?.groupId);

		console.log(
			`✅ Cleaned up thread ${threadId} from feed ${feedUuid} (${bindingsForFeed.length} bindings removed)`,
		);
	} catch (error) {
		console.error(`Error handling removed thread ${threadId}:`, error);
	}
}
