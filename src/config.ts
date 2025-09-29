interface Config {
	telegramBotToken: string;
	xdnmbApiBase: string;
	xdnmbFrontendBase: string;
	monitoringInterval: number;
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

export const config: Config = {
	telegramBotToken: getRequiredEnv("TELEGRAM_BOT_TOKEN"),
	xdnmbApiBase: getOptionalEnv("XDNMB_API_BASE", "https://api.nmb.best"),
	xdnmbFrontendBase: getOptionalEnv(
		"XDNMB_FRONTEND_BASE",
		"https://www.nmbxd1.com",
	),
	monitoringInterval: parseInterval(
		getOptionalEnv("MONITORING_INTERVAL", "5m"),
	),
};
