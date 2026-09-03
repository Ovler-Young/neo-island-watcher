function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

Deno.test({
	name: "get dispatches a raw all-format request to batch export",
	fn: async () => {
		const replies: string[] = [];
		const replyReceived = deferred<void>();
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
					replyReceived.resolve();
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
			await replyReceived.promise;
			await new Promise((resolve) => setTimeout(resolve, 10));

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

Deno.test("batch dispatch resolves while its export remains pending", async () => {
	const { createBatchExportScheduler } = await import("./get.ts");
	const exportCompletion = deferred<void>();
	const exportStarted = deferred<void>();
	const nextExportStarted = deferred<void>();
	const schedule = createBatchExportScheduler(async (_ctx, formats) => {
		if (formats[0] === "epub") {
			exportStarted.resolve();
			await exportCompletion.promise;
			return;
		}
		nextExportStarted.resolve();
	});
	const ctx = { reply: () => Promise.resolve({}) };

	const commandCompletion = Promise.resolve().then(() => {
		schedule(ctx, ["epub"]);
	});

	await exportStarted.promise;
	await commandCompletion;
	schedule(ctx, ["md"]);
	let exportFinished = false;
	let nextExportRunning = false;
	exportCompletion.promise.then(() => {
		exportFinished = true;
	});
	nextExportStarted.promise.then(() => {
		nextExportRunning = true;
	});
	await Promise.resolve();
	assert(!exportFinished, "command waited for the batch export to finish");
	assert(nextExportRunning === false, "batch exports ran concurrently");
	exportCompletion.resolve();
	await nextExportStarted.promise;
});

Deno.test("batch dispatch reports a background export rejection", async () => {
	const { createBatchExportScheduler } = await import("./get.ts");
	const replyAttempted = deferred<string>();
	const schedule = createBatchExportScheduler(() =>
		Promise.reject(new Error("export failed")),
	);
	const ctx = {
		reply: (message: string) => {
			replyAttempted.resolve(message);
			return Promise.resolve({});
		},
	};

	schedule(ctx, ["epub"]);

	const message = await replyAttempted.promise;
	assert(
		message.includes("/get all failed"),
		"background failure was not reported to the originating chat",
	);
});
