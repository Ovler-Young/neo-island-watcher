import { generateEpubVolumes } from "./epub.ts";

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

Deno.test("EPUB volumes preserve whole sections in order", async () => {
	const renderedMarkdown: string[] = [];
	const result = await generateEpubVolumes(
		"# Thread\n\n",
		["section-0", "section-1", "section-2", "section-3"],
		"Thread",
		25,
		(markdown) => {
			renderedMarkdown.push(markdown);
			const indexes = [...markdown.matchAll(/section-(\d)/g)].map((match) =>
				Number(match[1]),
			);
			const data = new Uint8Array(indexes.length * 20);
			data[0] = (indexes[0] ?? 0) + 1;
			return Promise.resolve(data);
		},
	);

	assert(
		result.volumes.length === 4,
		"sections were not split into fitting volumes",
	);
	assert(
		result.volumes.map((volume) => volume.data[0] - 1).join(",") === "0,1,2,3",
		"section identities were lost or reordered",
	);
	assert(
		result.volumes
			.map((volume) => `${volume.startSection}:${volume.endSection}`)
			.join(",") === "0:1,1:2,2:3,3:4",
		"volume section ranges differed",
	);
	assert(
		renderedMarkdown.every((markdown) => markdown.startsWith("# Thread\n\n")),
		"thread preamble was not repeated",
	);
	assert(
		renderedMarkdown.some((markdown) => markdown.includes("\n\n---\n\n")),
		"volume rendering did not use formatter boundaries",
	);
});

Deno.test("EPUB volumes report an indivisible section and keep adjacent sections", async () => {
	const result = await generateEpubVolumes(
		"# Thread\n\n",
		["small-0", "oversized-1", "small-2"],
		"Thread",
		30,
		(markdown) => {
			const size = markdown.includes("oversized-1")
				? markdown.includes("small-")
					? 80
					: 50
				: 20;
			const data = new Uint8Array(size);
			data[0] = markdown.includes("small-2") ? 3 : 1;
			return Promise.resolve(data);
		},
	);

	assert(
		result.oversizedSectionIndexes.join(",") === "1",
		"indivisible section was not reported",
	);
	assert(
		result.volumes.map((volume) => volume.data[0] - 1).join(",") === "0,2",
		"adjacent deliverable sections were dropped",
	);
});
