import { Bot, GrammyError, HttpError, InputFile } from "grammy";
import { normalizeTelegramFetch } from "./telegram-response.ts";
import { telegramAutoRetry } from "./telegram-retry.ts";

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function testBot(baseFetch: typeof fetch): Bot {
	const bot = new Bot("1:test", {
		client: { fetch: normalizeTelegramFetch(baseFetch) },
	});
	bot.api.config.use(telegramAutoRetry());
	return bot;
}

async function rejectedValue(operation: Promise<unknown>): Promise<unknown> {
	try {
		await operation;
	} catch (error) {
		return error;
	}
	throw new Error("operation unexpectedly succeeded");
}

function document(): InputFile {
	return new InputFile(new Uint8Array([1]), "export.epub");
}

Deno.test("sendDocument does not replay normalized gateway failures", async () => {
	let requests = 0;
	const bot = testBot(() => {
		requests++;
		return Promise.resolve(
			new Response("<html>bad gateway</html>", { status: 502 }),
		);
	});

	const error = await rejectedValue(bot.api.sendDocument(1, document()));

	assert(error instanceof GrammyError, "gateway failure was not an API error");
	assert(error.error_code === 502, "gateway status was not retained");
	assert(requests === 1, `document upload was submitted ${requests} times`);
});

Deno.test("sendDocument does not replay transport failures", async () => {
	let requests = 0;
	const bot = testBot(() => {
		requests++;
		return Promise.reject(new TypeError("connection lost"));
	});

	const error = await rejectedValue(bot.api.sendDocument(1, document()));

	assert(error instanceof HttpError, "transport failure was not an HTTP error");
	assert(requests === 1, `document upload was submitted ${requests} times`);
});

Deno.test("sendDocument retries explicit Telegram rate limits", async () => {
	let requests = 0;
	const bot = testBot(() => {
		requests++;
		return Promise.resolve(
			requests === 1
				? Response.json({
						ok: false,
						error_code: 429,
						description: "Too Many Requests",
						parameters: { retry_after: 0 },
					})
				: Response.json({
						ok: true,
						result: {
							message_id: 1,
							date: 0,
							chat: { id: 1, type: "private" },
						},
					}),
		);
	});

	const result = await bot.api.sendDocument(1, document());

	assert(result.message_id === 1, "retry did not return the Telegram result");
	assert(requests === 2, `rate-limited upload made ${requests} requests`);
});

Deno.test("other Telegram methods retain gateway retries", async () => {
	let requests = 0;
	const bot = testBot(() => {
		requests++;
		return Promise.resolve(
			requests === 1
				? new Response("<html>bad gateway</html>", { status: 502 })
				: Response.json({
						ok: true,
						result: {
							message_id: 1,
							date: 0,
							chat: { id: 1, type: "private" },
						},
					}),
		);
	});

	const result = await bot.api.sendMessage(1, "status");

	assert(result.message_id === 1, "retry did not return the Telegram result");
	assert(requests === 2, `message send made ${requests} requests`);
});
