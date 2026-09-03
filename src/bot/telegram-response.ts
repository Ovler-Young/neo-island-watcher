import { GrammyError, HttpError } from "grammy";

const INVALID_RESPONSE_PREFIX = "Invalid Telegram response";

export type DeliveryErrorCategory =
	| "size_rejection"
	| "rate_limit"
	| "telegram_api"
	| "server_gateway"
	| "network"
	| "invalid_response"
	| "conversion"
	| "unknown";

export interface ClassifiedDeliveryError {
	category: DeliveryErrorCategory;
	status?: number;
	code?: number;
}

/** Keep non-JSON proxy responses inside grammY's normal API error pipeline. */
export function normalizeTelegramFetch(
	baseFetch: typeof fetch = fetch,
): typeof fetch {
	const normalizedFetch = async (
		...args: Parameters<typeof fetch>
	): Promise<Response> => {
		const response = await baseFetch(...args);
		try {
			await response.clone().json();
			return response;
		} catch {
			const status = response.status;
			const statusText = sanitizeStatusText(response.statusText);
			const errorCode = status >= 400 && status <= 599 ? status : 422;
			const retryAfter =
				status === 429
					? parseRetryAfter(response.headers.get("retry-after"))
					: undefined;
			return Response.json(
				{
					ok: false,
					error_code: errorCode,
					description: `${INVALID_RESPONSE_PREFIX}: HTTP ${status} ${statusText}`,
					...(retryAfter === undefined
						? {}
						: { parameters: { retry_after: retryAfter } }),
				},
				{ status: 200 },
			);
		}
	};

	return normalizedFetch as typeof fetch;
}

export function classifyDeliveryError(
	error: unknown,
	stage: "delivery" | "conversion" = "delivery",
): ClassifiedDeliveryError {
	if (stage === "conversion") return { category: "conversion" };

	if (error instanceof GrammyError) {
		const code = error.error_code;
		const status = normalizedHttpStatus(error.description);
		if (isSizeDescription(error.description) || code === 413) {
			return { category: "size_rejection", status: status ?? 413, code };
		}
		if (code === 429 || typeof error.parameters.retry_after === "number") {
			return { category: "rate_limit", code };
		}
		if (code >= 500) {
			return { category: "server_gateway", status, code };
		}
		if (status !== undefined) {
			return { category: "invalid_response", status, code };
		}
		return { category: "telegram_api", code };
	}

	if (error instanceof HttpError) return { category: "network" };
	if (error instanceof SyntaxError) return { category: "invalid_response" };
	return { category: "unknown" };
}

function isSizeDescription(description: string): boolean {
	return /(?:file|request[ _-]*entity|payload)[ _-]*(?:is[ _-]*)?too[ _-]*(?:large|big)/i.test(
		description,
	);
}

function normalizedHttpStatus(description: string): number | undefined {
	if (!description.startsWith(INVALID_RESPONSE_PREFIX)) return undefined;
	const match = /: HTTP (\d{3})(?: |$)/.exec(description);
	return match ? Number(match[1]) : undefined;
}

function sanitizeStatusText(statusText: string): string {
	const sanitized = statusText
		.replace(/[^\x20-\x7e]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
	return sanitized || "Unknown Status";
}

function parseRetryAfter(value: string | null): number | undefined {
	if (value === null || !/^\d+$/.test(value)) return undefined;
	const seconds = Number(value);
	return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
}
