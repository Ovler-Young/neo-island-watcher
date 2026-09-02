import { Api, Context, InputFile } from "grammy";
import { sendDocumentFromPath } from "./file-utils.ts";

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
	const expected = new TextEncoder().encode("complete archive bytes");
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
			await sendDocumentFromPath(ctx, filePath, "archive.zip");
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
