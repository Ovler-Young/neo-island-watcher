import { config } from "../config.ts";
import { feedStates } from "../storage/feed-state.ts";

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
