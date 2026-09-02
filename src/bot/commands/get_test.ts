function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

Deno.test({
	name: "get dispatches a raw all-format request to batch export",
	fn: async () => {
		const replies: string[] = [];
		const server = Deno.serve(
			{ hostname: "127.0.0.1", port: 0, onListen: () => {} },
			async (request) => {
				const method = new URL(request.url).pathname.split("/").at(-1);
				let result: unknown = true;
				if (method === "getMe") {
					result = {
						id: 1,
						is_bot: true,
						first_name: "IslandBot",
						username: "island_bot",
					};
				} else if (method === "sendMessage") {
					const payload = await request.json();
					const text = String(payload.text);
					replies.push(text);
					result = {
						message_id: replies.length,
						date: 0,
						chat: { id: payload.chat_id, type: "private" },
						text,
					};
				}
				return Response.json({ ok: true, result });
			},
		);

		const originalToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
		const originalApiRoot = Deno.env.get("TELEGRAM_API_ROOT");
		try {
			Deno.env.set("TELEGRAM_BOT_TOKEN", "test");
			Deno.env.set(
				"TELEGRAM_API_ROOT",
				`http://${server.addr.hostname}:${server.addr.port}`,
			);
			const { bot } = await import("../bot.ts");
			await bot.init();
			await bot.handleUpdate({
				update_id: 1,
				message: {
					message_id: 1,
					date: 0,
					chat: {
						id: -9007199254740991,
						type: "private",
						first_name: "Oliver",
					},
					from: { id: 2, is_bot: false, first_name: "Oliver" },
					text: "/get all epub",
					entities: [{ type: "bot_command", offset: 0, length: 4 }],
				},
			});

			assert(
				replies[0] === "❌ No threads are bound to this chat.",
				"raw batch request fell through to single-thread selection",
			);
		} finally {
			if (originalToken === undefined) Deno.env.delete("TELEGRAM_BOT_TOKEN");
			else Deno.env.set("TELEGRAM_BOT_TOKEN", originalToken);
			if (originalApiRoot === undefined) Deno.env.delete("TELEGRAM_API_ROOT");
			else Deno.env.set("TELEGRAM_API_ROOT", originalApiRoot);
			await server.shutdown();
		}
	},
});
