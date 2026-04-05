import { config } from "../config.ts";
import { feedStates } from "../storage/feed-state.ts";
import type { ThreadStateData } from "../storage/thread-state.ts";
import { threadStates } from "../storage/thread-state.ts";

import { checkFeed } from "./feed.ts";
import { checkExistingThreads } from "./thread.ts";

let feedInterval: number | undefined;
let threadInterval: number | undefined;

export async function startMonitoring(): Promise<void> {
	console.log("📡 Starting feed & thread monitoring...");

	if (feedInterval) {
		clearInterval(feedInterval);
	}
	if (threadInterval) {
		clearInterval(threadInterval);
	}

	// Run both immediately on startup.
	await checkAllFeeds();
	await checkExistingThreads();

	feedInterval = setInterval(async () => {
		try {
			await checkAllFeeds();
		} catch (error) {
			console.error("Error during feed monitoring cycle:", error);
		}
	}, config.feedCheckInterval);

	threadInterval = setInterval(async () => {
		try {
			await checkExistingThreads();
		} catch (error) {
			console.error("Error during thread monitoring cycle:", error);
		}
	}, config.threadCheckInterval);

	console.log(
		`✅ Monitoring started — feeds every ${config.feedCheckInterval / 1000}s, threads every ${config.threadCheckInterval / 1000}s`,
	);
}

export function stopMonitoring(): void {
	if (feedInterval) {
		clearInterval(feedInterval);
		feedInterval = undefined;
	}
	if (threadInterval) {
		clearInterval(threadInterval);
		threadInterval = undefined;
	}
	console.log("🛑 Monitoring stopped");
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
	} else {
		return msSinceLastCheck >= config.threadCheckInterval;
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
