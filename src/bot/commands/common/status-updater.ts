import type { Api, RawApi } from "grammy";

type EditMessageOptions = {
	parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
};

/**
 * Throttled status message updater to avoid Telegram rate limits.
 * Ensures minimum interval between updates (default 10s).
 */
export class StatusMessageUpdater {
	private lastUpdateTime = 0;
	private lastText = "";

	constructor(
		private readonly api: Api<RawApi>,
		private readonly chatId: number,
		private readonly messageId: number,
		private readonly minIntervalMs = 10000,
	) {}

	/**
	 * Update status message with throttling.
	 * Skips update if called within minIntervalMs of last update.
	 * Also skips if text is identical to last update.
	 */
	update(text: string, options?: EditMessageOptions): Promise<boolean> {
		const now = Date.now();
		if (text === this.lastText) {
			return Promise.resolve(false);
		}
		if (now - this.lastUpdateTime < this.minIntervalMs) {
			return Promise.resolve(false);
		}
		return this.doUpdate(text, options);
	}

	/**
	 * Force update status message, ignoring throttle.
	 * Use for phase transitions.
	 */
	forceUpdate(text: string, options?: EditMessageOptions): Promise<boolean> {
		if (text === this.lastText) {
			return Promise.resolve(false);
		}
		return this.doUpdate(text, options);
	}

	/**
	 * Delete the status message.
	 */
	async delete(): Promise<void> {
		try {
			await this.api.deleteMessage(this.chatId, this.messageId);
		} catch {
			// Ignore deletion errors
		}
	}

	private async doUpdate(
		text: string,
		options?: EditMessageOptions,
	): Promise<boolean> {
		try {
			await this.api.editMessageText(
				this.chatId,
				this.messageId,
				text,
				options,
			);
			this.lastUpdateTime = Date.now();
			this.lastText = text;
			return true;
		} catch (err) {
			console.error("Failed to update status message:", err);
			return false;
		}
	}
}

/**
 * Create a StatusMessageUpdater if statusMsg exists, otherwise return null.
 */
export function createStatusUpdater(
	api: Api<RawApi>,
	chatId: number | undefined,
	statusMsg: { message_id: number } | null,
	minIntervalMs = 10000,
): StatusMessageUpdater | null {
	if (!chatId || !statusMsg) {
		return null;
	}
	return new StatusMessageUpdater(
		api,
		chatId,
		statusMsg.message_id,
		minIntervalMs,
	);
}
