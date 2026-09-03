import { GrammyError, HttpError } from "grammy";
import {
	classifyDeliveryError,
	normalizeTelegramFetch,
} from "./telegram-response.ts";

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function telegramError(code: number, description: string): GrammyError {
	return new GrammyError(
		"sendDocument failed",
		{ ok: false, error_code: code, description },
		"sendDocument",
		{},
	);
}

Deno.test("valid Telegram JSON responses pass through unchanged", async () => {
	const original = Response.json({ ok: true, result: { message_id: 1 } });
	const wrapped = normalizeTelegramFetch(() => Promise.resolve(original));
	const response = await wrapped("https://example.invalid");

	assert(response === original, "valid response was replaced");
	assert((await response.json()).ok === true, "valid response body changed");
});

Deno.test("non-JSON gateway responses retain safe status without retaining body", async () => {
	const rawBody = "<html>secret upstream response</html>";
	const wrapped = normalizeTelegramFetch(() =>
		Promise.resolve(
			new Response(rawBody, { status: 502, statusText: "Bad Gateway" }),
		),
	);
	const response = await wrapped(
		"https://example.invalid/bot-secret/sendDocument",
	);
	const payload = await response.json();
	const serialized = JSON.stringify(payload);

	assert(payload.ok === false, "normalized response was not a Telegram error");
	assert(payload.error_code === 502, "gateway status was not retained");
	assert(
		payload.description.includes("502 Bad Gateway"),
		"safe status metadata was omitted",
	);
	assert(!serialized.includes("secret upstream"), "raw HTML body leaked");
	assert(!serialized.includes("bot-secret"), "request URL leaked");
	assert(
		classifyDeliveryError(
			telegramError(payload.error_code, payload.description),
		).category === "server_gateway",
		"normalized gateway response was not retryable server/API shape",
	);
});

Deno.test("non-JSON 413 and successful responses classify without ambiguity", async () => {
	const sizeFetch = normalizeTelegramFetch(() =>
		Promise.resolve(
			new Response("proxy page", {
				status: 413,
				statusText: "Payload Too Large",
			}),
		),
	);
	const sizePayload = await (await sizeFetch("https://example.invalid")).json();
	assert(
		classifyDeliveryError(
			telegramError(sizePayload.error_code, sizePayload.description),
		).category === "size_rejection",
		"HTTP 413 did not classify as size rejection",
	);

	const invalidFetch = normalizeTelegramFetch(() =>
		Promise.resolve(
			new Response("not json", { status: 200, statusText: "OK" }),
		),
	);
	const invalidPayload = await (
		await invalidFetch("https://example.invalid")
	).json();
	assert(
		invalidPayload.error_code === 422,
		"successful non-JSON response became a server error",
	);
	assert(
		classifyDeliveryError(
			telegramError(invalidPayload.error_code, invalidPayload.description),
		).category === "invalid_response",
		"successful non-JSON response was misclassified",
	);
});

Deno.test("delivery classification distinguishes rate limits, API, network, and conversion", () => {
	const rateLimit = new GrammyError(
		"limited",
		{
			ok: false,
			error_code: 429,
			description: "Too Many Requests",
			parameters: { retry_after: 1 },
		},
		"sendDocument",
		{},
	);
	assert(
		classifyDeliveryError(rateLimit).category === "rate_limit",
		"429 category differed",
	);
	assert(
		classifyDeliveryError(telegramError(401, "Unauthorized")).category ===
			"telegram_api",
		"Telegram API category differed",
	);
	assert(
		classifyDeliveryError(
			new HttpError("request failed", new TypeError("network")),
		).category === "network",
		"network category differed",
	);
	assert(
		classifyDeliveryError(new Error("pandoc stderr"), "conversion").category ===
			"conversion",
		"conversion category differed",
	);
});
