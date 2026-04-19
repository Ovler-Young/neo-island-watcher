interface Config {
	telegramBotToken: string;
	telegramApiRoot: string;
	xdnmbApiBase: string;
	xdnmbFrontendBase: string;
	xdnmbImageBase: string;
	xdnmbProxyFormatEnabled: boolean;
	/** How often to poll individual threads for new replies. */
	threadCheckInterval: number;
	/** How often to poll feeds for new threads. */
	feedCheckInterval: number;
	inactiveThreadDays: number;
	inactiveCheckInterval: number;
}

function parseInterval(interval: string): number {
	const match = interval.match(/^(\d+)([smh])$/);
	if (!match) {
		throw new Error(`Invalid interval format: ${interval}`);
	}

	const value = Number.parseInt(match[1], 10);
	const unit = match[2];

	switch (unit) {
		case "s":
			return value * 1000;
		case "m":
			return value * 60 * 1000;
		case "h":
			return value * 60 * 60 * 1000;
		default:
			throw new Error(`Unknown time unit: ${unit}`);
	}
}

function parseBoolean(value: string): boolean {
	switch (value.trim().toLowerCase()) {
		case "1":
		case "true":
		case "yes":
		case "on":
			return true;
		case "0":
		case "false":
		case "no":
		case "off":
			return false;
		default:
			throw new Error(`Invalid boolean format: ${value}`);
	}
}

function getRequiredEnv(key: string): string {
	const value = Deno.env.get(key);
	if (!value) {
		throw new Error(`Required environment variable ${key} is not set`);
	}
	return value;
}

function getOptionalEnv(key: string, defaultValue: string): string {
	return Deno.env.get(key) ?? defaultValue;
}

function getOptionalBooleanEnv(key: string, defaultValue: boolean): boolean {
	const value = Deno.env.get(key);
	if (value === undefined) {
		return defaultValue;
	}

	return parseBoolean(value);
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

export const config: Config = {
	telegramBotToken: getRequiredEnv("TELEGRAM_BOT_TOKEN"),
	telegramApiRoot: getOptionalEnv(
		"TELEGRAM_API_ROOT",
		"https://api.telegram.org",
	),
	xdnmbApiBase: trimTrailingSlash(
		getOptionalEnv("XDNMB_API_BASE", "https://api.nmb.best"),
	),
	xdnmbFrontendBase: trimTrailingSlash(
		getOptionalEnv("XDNMB_FRONTEND_BASE", "https://www.nmbxd1.com"),
	),
	xdnmbImageBase: trimTrailingSlash(
		getOptionalEnv("XDNMB_IMAGE_BASE", "https://image.nmb.best"),
	),
	xdnmbProxyFormatEnabled: getOptionalBooleanEnv(
		"XDNMB_PROXY_FORMAT_ENABLED",
		false,
	),
	threadCheckInterval: parseInterval(
		getOptionalEnv("THREAD_CHECK_INTERVAL", "5m"),
	),
	feedCheckInterval: parseInterval(
		getOptionalEnv("FEED_CHECK_INTERVAL", "1h"),
	),
	inactiveThreadDays: Number.parseInt(
		getOptionalEnv("INACTIVE_THREAD_DAYS", "31"),
		10,
	),
	inactiveCheckInterval: parseInterval(
		getOptionalEnv("INACTIVE_CHECK_INTERVAL", "24h"),
	),
};
