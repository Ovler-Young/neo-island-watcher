export function extractThreadIdFromTopic(ctx: {
	message?: {
		reply_to_message?: { text?: string };
		text?: string;
	};
}): string | null {
	try {
		if (ctx.message?.reply_to_message?.text) {
			const match = ctx.message.reply_to_message.text.match(/\d{8}/);
			return match ? match[0] : null;
		}

		if (ctx.message?.text) {
			const match = ctx.message.text.match(/\d{8}/);
			return match ? match[0] : null;
		}

		return null;
	} catch {
		return null;
	}
}
