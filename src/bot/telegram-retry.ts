import type { Transformer } from "grammy";
import { autoRetry } from "grammy/auto-retry";

/** Avoid replaying document uploads after an ambiguous delivery response. */
export function telegramAutoRetry(): Transformer {
	const defaultRetry = autoRetry();
	const documentRetry = autoRetry({
		rethrowHttpErrors: true,
		rethrowInternalServerErrors: true,
	});

	return (prev, method, payload, signal) => {
		const retry = method === "sendDocument" ? documentRetry : defaultRetry;
		return retry(prev, method, payload, signal);
	};
}
