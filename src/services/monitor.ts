import { config } from "../config.ts";
import { feedStates } from "../storage/feed-state.ts";
import type { ThreadStateData } from "../storage/thread-state.ts";
import { threadStates } from "../storage/thread-state.ts";

import { checkFeed } from "./feed.ts";
import { checkExistingThreads } from "./thread.ts";

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

export async function shouldCheckThread(
	threadId: string,
	threadState: ThreadStateData,
): Promise<boolean> {
	if (!threadState.lastNewReplyAt) {
		await threadStates.updateThreadState(threadId, {
			lastNewReplyAt: threadState.lastCheck,
		});
		return true;
	}

	const now = Date.now();
	const msSinceNewReply = now - new Date(threadState.lastNewReplyAt).getTime();
	const msSinceLastCheck = now - new Date(threadState.lastCheck).getTime();

	const inactiveThreshold = config.inactiveThreadDays * 24 * 60 * 60 * 1000;

	if (msSinceNewReply > inactiveThreshold) {
		return msSinceLastCheck >= config.inactiveCheckInterval;
	}

	return true;
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

		// Also check existing threads for new replies
		await checkExistingThreads();
	} catch (error) {
		console.error("Error in checkAllFeeds:", error);
	}
}
