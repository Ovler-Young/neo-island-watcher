import { SplitZipWriter, type ZipArchiveBatch } from "../../../export/zip.ts";
import {
	ARCHIVE_FALLBACK_CAPS,
	uploadArchivesAdaptively,
} from "./archive-upload.ts";

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function createBatch(
	directory: string,
	entries: Array<[string, number]>,
	cap: number,
): Promise<ZipArchiveBatch> {
	const writer = new SplitZipWriter(directory, cap);
	for (const [name, size] of entries) {
		assert(
			await writer.add(name, new Uint8Array(size)),
			`failed to add ${name}`,
		);
	}
	return { archives: await writer.finish(), cleanup: () => writer.cleanup() };
}

Deno.test("adaptive archive upload advances through meaningful fallback caps", async () => {
	const directory = await Deno.makeTempDir();
	const logs: string[] = [];
	try {
		const batch = await createBatch(
			directory,
			[
				["one.txt", 100],
				["two.txt", 100],
				["three.txt", 100],
			],
			1_000,
		);
		const result = await uploadArchivesAdaptively(
			batch,
			directory,
			"export",
			{
				upload: (archive) =>
					archive.size > 250
						? Promise.reject(new SyntaxError("HTML response"))
						: Promise.resolve(),
				replyFailure: () => Promise.resolve(),
				log: (message) => logs.push(message),
			},
			[500, 300, 200],
		);

		assert(!result.uploadFailed, "upload should recover");
		assert(
			logs.filter((line) => line.startsWith("Repartitioning")).join("|") ===
				"Repartitioning remaining archives with cap 500 bytes|Repartitioning remaining archives with cap 300 bytes",
			"fallback sequence differed",
		);
	} finally {
		await Deno.remove(directory, { recursive: true }).catch(() => {});
	}
});

Deno.test("adaptive archive upload does not resend a delivered part", async () => {
	const directory = await Deno.makeTempDir();
	const uploadedNames: string[] = [];
	const attemptedFilenames: string[] = [];
	const attemptedPaths: string[] = [];
	let calls = 0;
	try {
		const batch = await createBatch(
			directory,
			[
				["one.txt", 30],
				["two.txt", 30],
				["three.txt", 30],
				["four.txt", 30],
				["five.txt", 30],
			],
			300,
		);
		const result = await uploadArchivesAdaptively(
			batch,
			directory,
			"export",
			{
				upload: (archive, filename) => {
					calls++;
					attemptedFilenames.push(filename);
					attemptedPaths.push(archive.path);
					if (calls === 2) return Promise.reject(new Error("upload failed"));
					uploadedNames.push(...archive.entries.map((entry) => entry.name));
					return Promise.resolve();
				},
				replyFailure: () => Promise.resolve(),
				log: () => {},
			},
			[200],
		);

		assert(!result.uploadFailed, "upload should recover");
		assert(
			uploadedNames.join(",") === "one.txt,two.txt,three.txt,four.txt,five.txt",
			"a delivered entry was resent or an entry was lost",
		);
		assert(
			attemptedFilenames.join(",") ===
				"export_part_1.zip,export_part_2.zip,export_part_2.zip,export_part_3.zip,export_part_4.zip",
			"part names were not stable across fallback",
		);
		for (const path of new Set(attemptedPaths)) {
			assert(
				await Deno.stat(path).then(
					() => false,
					() => true,
				),
				`temporary archive was not removed: ${path}`,
			);
		}
	} finally {
		await Deno.remove(directory, { recursive: true }).catch(() => {});
	}
});

Deno.test("adaptive archive upload reports entries remaining after the smallest part fails", async () => {
	const directory = await Deno.makeTempDir();
	let reported = 0;
	try {
		assert(
			ARCHIVE_FALLBACK_CAPS.at(-1) === 40_000_000,
			"production fallback must end at 40 MB",
		);
		const batch = await createBatch(
			directory,
			[
				["one.txt", 30],
				["two.txt", 30],
			],
			500,
		);
		const result = await uploadArchivesAdaptively(
			batch,
			directory,
			"export",
			{
				upload: () => Promise.reject(new SyntaxError("raw HTML")),
				replyFailure: (remainingEntries) => {
					reported = remainingEntries;
					return Promise.resolve();
				},
				log: () => {},
			},
			[200, 150],
		);

		assert(result.uploadFailed, "exhausted upload should fail cleanly");
		assert(reported === 2, "remaining entry count was not reported");
	} finally {
		await Deno.remove(directory, { recursive: true }).catch(() => {});
	}
});

Deno.test("adaptive archive upload omits an indivisible entry and delivers the rest", async () => {
	const directory = await Deno.makeTempDir();
	const delivered: string[] = [];
	let calls = 0;
	try {
		const batch = await createBatch(
			directory,
			[
				["large.txt", 200],
				["small.txt", 10],
			],
			600,
		);
		const result = await uploadArchivesAdaptively(
			batch,
			directory,
			"export",
			{
				upload: (archive) => {
					calls++;
					if (calls === 1) return Promise.reject(new Error("upload failed"));
					delivered.push(...archive.entries.map((entry) => entry.name));
					return Promise.resolve();
				},
				replyFailure: () => Promise.resolve(),
				log: () => {},
			},
			[250],
		);

		assert(!result.uploadFailed, "remaining entry should upload");
		assert(result.omittedEntries.join(",") === "large.txt", "wrong omission");
		assert(delivered.join(",") === "small.txt", "remaining entry was lost");
	} finally {
		await Deno.remove(directory, { recursive: true }).catch(() => {});
	}
});
