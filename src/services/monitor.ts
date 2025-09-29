import type { FeedThread } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { bot } from "../bot/bot.ts";
import { config } from "../config.ts";
import { feedStates } from "../storage/feed-state.ts";

let monitoringInterval: number | undefined;

export async function startMonitoring(): Promise<void> {
	console.log("📡 Starting feed monitoring...");

	if (monitoringInterval) {
		clearInterval(monitoringInterval);
	}

	await checkAllFeeds();

	monitoringInterval = setInterval(async () => {
		try {
			await checkAllFeeds();
		} catch (error) {
			console.error("Error during monitoring cycle:", error);
		}
	}, config.monitoringInterval);

	console.log(
		`✅ Monitoring started with ${config.monitoringInterval}ms interval`,
	);
}

export function stopMonitoring(): void {
	if (monitoringInterval) {
		clearInterval(monitoringInterval);
		monitoringInterval = undefined;
		console.log("🛑 Monitoring stopped");
	}
}

async function checkAllFeeds(): Promise<void> {
	try {
		const activeFeeds = await feedStates.getAllActiveFeeds();

		if (activeFeeds.length === 0) {
			console.log("📪 No active feeds to monitor");
			return;
		}

		console.log(`🔍 Checking ${activeFeeds.length} active feeds...`);

		for (const feedUuid of activeFeeds) {
			try {
				await checkFeed(feedUuid);
				await new Promise((resolve) => setTimeout(resolve, 1000));
			} catch (error) {
				console.error(`Error checking feed ${feedUuid}:`, error);
			}
		}
	} catch (error) {
		console.error("Error in checkAllFeeds:", error);
	}
}

async function checkFeed(feedUuid: string): Promise<void> {
	try {
		const feedData = await xdnmbClient.getFeed(feedUuid);
		const currentThreadIds = feedData.map((thread) => thread.id);

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

		await feedStates.updateFeedCheck(feedUuid, currentThreadIds);
	} catch (error) {
		console.error(`Error checking feed ${feedUuid}:`, error);
	}
}

async function handleNewThread(
	thread: FeedThread,
	feedUuid: string,
): Promise<void> {
	console.log(`🆕 New thread detected: ${thread.id} - ${thread.title}`);

	const state = await feedStates.getFeedState(feedUuid);
	if (!state) {
		return;
	}

	for (const groupId of state.boundGroups) {
		try {
			await bot.api.sendMessage(
				groupId,
				`🆕 New thread detected: ${thread.title}\n` +
					`📝 Content: ${thread.content.substring(0, 100)}...\n` +
					`🔗 ${xdnmbClient.buildThreadUrl(thread.id)}`,
			);
		} catch (error) {
			console.error(`Error sending notification to group ${groupId}:`, error);
		}
	}
}
