import { SplitZipWriter } from "./zip.ts";

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

Deno.test("SplitZipWriter creates valid archives below the configured limit", async () => {
	const directory = await Deno.makeTempDir();
	const writer = new SplitZipWriter(directory, 150);
	try {
		assert(await writer.add("one.txt", new Uint8Array(32)), "first entry");
		assert(await writer.add("two.txt", new Uint8Array(32)), "second entry");
		const archives = await writer.finish();
		assert(
			archives.length === 2,
			"entries should be split across two archives",
		);

		const names: string[] = [];
		for (const archive of archives) {
			assert(archive.size <= 150, "archive exceeds configured limit");
			const validation = await new Deno.Command("unzip", {
				args: ["-t", archive.path],
				stdout: "null",
				stderr: "piped",
			}).output();
			assert(validation.success, "unzip rejected the generated archive");

			const listing = await new Deno.Command("unzip", {
				args: ["-Z1", archive.path],
				stdout: "piped",
				stderr: "piped",
			}).output();
			assert(listing.success, "failed to list generated archive");
			names.push(
				...new TextDecoder().decode(listing.stdout).trim().split("\n"),
			);
		}
		assert(names.join(",") === "one.txt,two.txt", "archive entries differ");
	} finally {
		await writer.cleanup();
		await Deno.remove(directory, { recursive: true }).catch(() => {});
	}
});

Deno.test("SplitZipWriter rejects an entry that cannot fit in an empty part", async () => {
	const directory = await Deno.makeTempDir();
	const writer = new SplitZipWriter(directory, 120);
	try {
		assert(
			!(await writer.add("oversized.txt", new Uint8Array(32))),
			"oversized entry should be rejected",
		);
		assert((await writer.finish()).length === 0, "empty archive was finalized");
	} finally {
		await writer.cleanup();
		await Deno.remove(directory, { recursive: true }).catch(() => {});
	}
});
