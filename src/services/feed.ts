import { xdnmbClient } from "../api/xdnmb.ts";
import { feedStates } from "../storage/feed-state.ts";
import { handleNewThread } from "./thread.ts";

export async function checkFeed(feedUuid: string): Promise<void> {
	try {
		let pageno = 1;
		let ThreadIds: string[] = [];
		while (true) {
			const feedData = await xdnmbClient.getFeed(feedUuid, pageno);
			if (feedData.length === 0) {
				break;
			}
			const currentThreadIds = feedData.map((thread) => thread.id);
			ThreadIds = ThreadIds.concat(currentThreadIds);
			const state = await feedStates.getFeedState(feedUuid);
			const knownThreads = state?.knownThreads || [];

			const newThreads = currentThreadIds.filter(
				(id) => !knownThreads.includes(id),
			);

			if (newThreads.length > 0) {
				console.log(
					`📄 Found ${newThreads.length} new threads in feed ${feedUuid}`,
				);

				for (const threadId of newThreads) {
					const thread = feedData.find((t) => t.id === threadId);
					if (thread) {
						await handleNewThread(thread, feedUuid);
					}
				}
			}
			pageno++;
		}

		await feedStates.updateFeedCheck(feedUuid, ThreadIds);
	} catch (error) {
		console.error(`Error checking feed ${feedUuid}:`, error);
	}
}
