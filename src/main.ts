import { bot } from "./bot/bot.ts";
import { startMonitoring } from "./services/monitor.ts";

async function main() {
	console.log("🏝️ Neo Island Watcher starting...");

	console.log("📱 Starting Telegram bot...");
	await bot.start();

	console.log("🔍 Starting monitoring service...");
	await startMonitoring();

	console.log("✅ Neo Island Watcher is running!");
}

if (import.meta.main) {
	main().catch((error) => {
		console.error("❌ Fatal error:", error);
		Deno.exit(1);
	});
}
