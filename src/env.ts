export interface AppConfig {
  telegram: {
    botToken: string;
  };
  api: {
    baseUrl: string;
  };
  frontend: {
    baseUrl: string;
  };
  monitoring: {
    intervalMinutes: number;
  };
}

export function loadConfig(): AppConfig {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
  }

  return {
    telegram: {
      botToken,
    },
    api: {
      baseUrl: Deno.env.get("XDNMB_API_BASE") || "https://api.nmb.best",
    },
    frontend: {
      baseUrl: Deno.env.get("XDNMB_FRONTEND_BASE") || "https://www.nmbxd1.com",
    },
    monitoring: {
      intervalMinutes: parseInt(
        Deno.env.get("MONITORING_INTERVAL") || "5",
      ),
    },
  };
}
