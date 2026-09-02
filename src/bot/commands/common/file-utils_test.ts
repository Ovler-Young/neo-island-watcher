import { Api, Context, InputFile } from "grammy";
import { sendDocument, sendDocumentFromPath } from "./file-utils.ts";

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function consume(inputFile: InputFile): Promise<Uint8Array> {
	const raw = await inputFile.toRaw();
	if (raw instanceof Uint8Array) return raw;

	const chunks: Uint8Array[] = [];
	let length = 0;
	for await (const chunk of raw) {
		chunks.push(chunk);
		length += chunk.length;
	}

	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

Deno.test("path-backed document uploads can be serialized twice", async () => {
	const expected = new TextEncoder().encode("complete export bytes");
	const filePath = await Deno.makeTempFile();
	let first: Uint8Array | undefined;
	let second: Uint8Array | undefined;
	const uploadInspected = new Error("upload inspected");
	try {
		await Deno.writeFile(filePath, expected);
		const api = new Api("test");
		api.config.use(async (_prev, _method, payload) => {
			assert(
				"document" in payload,
				"upload payload did not contain a document",
			);
			const inputFile = payload.document;
			assert(inputFile instanceof InputFile, "document was not an InputFile");
			first = await consume(inputFile);
			second = await consume(inputFile);
			throw uploadInspected;
		});
		const ctx = new Context(
			{
				update_id: 1,
				message: {
					message_id: 2,
					date: 0,
					chat: { id: 123, type: "private", first_name: "Test" },
					from: { id: 2, is_bot: false, first_name: "Test" },
					message_thread_id: 456,
				},
			},
			api,
			{
				id: 1,
				is_bot: true,
				first_name: "Test Bot",
				username: "test_bot",
				can_join_groups: true,
				can_read_all_group_messages: false,
				supports_inline_queries: false,
				can_connect_to_business: false,
				has_main_web_app: false,
			},
		);

		try {
			await sendDocumentFromPath(ctx, filePath, "export.epub");
			throw new Error("upload transformer was not reached");
		} catch (error) {
			assert(error === uploadInspected, "upload failed before serialization");
		}

		assert(first !== undefined, "first serialization was not consumed");
		assert(second !== undefined, "second serialization was not consumed");
		assert(
			first.length === expected.length &&
				first.every((byte, index) => byte === expected[index]),
			"first serialization did not contain the complete file",
		);
		assert(
			second.length === expected.length &&
				second.every((byte, index) => byte === expected[index]),
			"second serialization did not contain the complete file",
		);
	} finally {
		await Deno.remove(filePath).catch(() => {});
	}
});

Deno.test("buffer-backed document uploads use isolated replayable temporary files", async () => {
	const tempFilesBefore = await listDocumentTempFiles();
	const api = new Api("test");
	const consumed: string[] = [];
	let started = 0;
	let release: (() => void) | undefined;
	const bothStarted = new Promise<void>((resolve) => {
		release = resolve;
	});
	api.config.use(async (_prev, _method, payload) => {
		assert("document" in payload, "upload payload did not contain a document");
		const inputFile = payload.document;
		assert(inputFile instanceof InputFile, "document was not an InputFile");
		started++;
		if (started === 2) release?.();
		await bothStarted;
		const first = await consume(inputFile);
		const second = await consume(inputFile);
		assert(
			first.length === second.length &&
				first.every((byte, index) => byte === second[index]),
			"temporary upload source was not replayable",
		);
		consumed.push(new TextDecoder().decode(first));
		throw new Error("upload inspected");
	});
	const ctx = new Context(
		{
			update_id: 1,
			message: {
				message_id: 2,
				date: 0,
				chat: { id: 123, type: "private", first_name: "Test" },
				from: { id: 2, is_bot: false, first_name: "Test" },
			},
		},
		api,
		{
			id: 1,
			is_bot: true,
			first_name: "Test Bot",
			username: "test_bot",
			can_join_groups: true,
			can_read_all_group_messages: false,
			supports_inline_queries: false,
			can_connect_to_business: false,
			has_main_web_app: false,
		},
	);
	await Promise.allSettled([
		sendDocument(ctx, new TextEncoder().encode("first"), "same.epub"),
		sendDocument(ctx, new TextEncoder().encode("second"), "same.epub"),
	]);
	consumed.sort();
	assert(
		consumed.join(",") === "first,second",
		"concurrent uploads shared temporary contents",
	);
	assert(
		(await listDocumentTempFiles()).join(",") === tempFilesBefore.join(","),
		"temporary upload files were not cleaned up after failure",
	);
});

async function listDocumentTempFiles(): Promise<string[]> {
	try {
		const names: string[] = [];
		for await (const entry of Deno.readDir("data/temp")) {
			if (entry.name.startsWith("document-")) names.push(entry.name);
		}
		return names.sort();
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return [];
		throw error;
	}
}
