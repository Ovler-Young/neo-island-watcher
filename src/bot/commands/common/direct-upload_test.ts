import type { EpubVolumeResult } from "../../../export/epub.ts";
import {
	DirectUploadCapState,
	TELEGRAM_DOCUMENT_MAX_BYTES,
	uploadEpubDirectly,
} from "./direct-upload.ts";

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function volumes(
	ranges: Array<[number, number]>,
	oversizedSectionIndexes: number[] = [],
): EpubVolumeResult {
	return {
		volumes: ranges.map(([startSection, endSection]) => ({
			data: new Uint8Array([startSection, endSection]),
			startSection,
			endSection,
		})),
		oversizedSectionIndexes,
	};
}

Deno.test("a successful full EPUB uploads once without lowering the cap", async () => {
	const capState = new DirectUploadCapState(1_000);
	let fullUploads = 0;
	let volumeGenerations = 0;
	const result = await uploadEpubDirectly({
		fullData: new Uint8Array(100),
		sectionCount: 3,
		capState,
		fallbackCaps: [80],
		generateVolumes: () => {
			volumeGenerations++;
			return Promise.resolve(volumes([]));
		},
		uploadFull: () => {
			fullUploads++;
			return Promise.resolve();
		},
		uploadVolume: () => Promise.resolve(),
	});

	assert(fullUploads === 1, "full EPUB was not uploaded exactly once");
	assert(volumeGenerations === 0, "volumes were generated unnecessarily");
	assert(result.sentFiles === 1, "full EPUB was not counted");
	assert(capState.get() === 1_000, "successful full upload lowered the cap");
});

Deno.test("fallback learns a successful cap and resumes after partial delivery", async () => {
	const capState = new DirectUploadCapState(1_000);
	const generated: Array<[number, number]> = [];
	const attempted: Array<[number, number, number]> = [];
	const delivered: Array<[number, number, number]> = [];
	const result = await uploadEpubDirectly({
		fullData: new Uint8Array(900),
		sectionCount: 4,
		capState,
		fallbackCaps: [500, 300],
		generateVolumes: (start, cap) => {
			generated.push([start, cap]);
			return Promise.resolve(
				cap === 500
					? volumes([
							[start, start + 2],
							[start + 2, 4],
						])
					: volumes([[start, 4]]),
			);
		},
		uploadFull: () => Promise.reject(new Error("proxy rejected upload")),
		uploadVolume: (_data, number, start, end) => {
			attempted.push([number, start, end]);
			if (start === 2 && end === 4 && generated.length === 1) {
				return Promise.reject(new Error("proxy rejected volume"));
			}
			delivered.push([number, start, end]);
			return Promise.resolve();
		},
	});

	assert(
		generated.map(([start, cap]) => `${start}:${cap}`).join(",") ===
			"0:500,2:300",
		"fallback did not regenerate only undelivered ranges",
	);
	assert(
		delivered.map((item) => item.join(":")).join(",") === "1:0:2,2:2:4",
		"successful section ranges were resent or volume numbering skipped",
	);
	assert(attempted.length === 3, "expected failed volume attempt was missing");
	assert(result.sentFiles === 2, "delivered volumes were counted incorrectly");
	assert(
		capState.get() === 300,
		"smallest successful fallback was not learned",
	);
});

Deno.test("indivisible EPUB chapters are reported while adjacent volumes continue", async () => {
	const delivered: string[] = [];
	const result = await uploadEpubDirectly({
		fullData: new Uint8Array(200),
		sectionCount: 3,
		capState: new DirectUploadCapState(100),
		fallbackCaps: [],
		generateVolumes: () =>
			Promise.resolve(
				volumes(
					[
						[0, 1],
						[2, 3],
					],
					[1],
				),
			),
		uploadFull: () =>
			Promise.reject(new Error("must not upload oversized full")),
		uploadVolume: (_data, _number, start, end) => {
			delivered.push(`${start}:${end}`);
			return Promise.resolve();
		},
	});

	assert(delivered.join(",") === "0:1,2:3", "adjacent volumes were omitted");
	assert(
		result.oversizedSectionIndexes.join(",") === "1",
		"oversized chapter was not reported",
	);
	assert(
		!result.deliveryFailed,
		"an omitted indivisible chapter aborted delivery",
	);
});

Deno.test("exhausted EPUB fallbacks report undelivered chapters", async () => {
	const capState = new DirectUploadCapState(1_000);
	const result = await uploadEpubDirectly({
		fullData: new Uint8Array(500),
		sectionCount: 4,
		capState,
		fallbackCaps: [300, 100],
		generateVolumes: (start) => Promise.resolve(volumes([[start, 4]])),
		uploadFull: () => Promise.reject(new SyntaxError("raw HTML")),
		uploadVolume: () => Promise.reject(new SyntaxError("raw HTML")),
	});

	assert(result.deliveryFailed, "exhausted fallback was not reported");
	assert(
		result.undeliveredSectionIndexes.join(",") === "0,1,2,3",
		"remaining chapters differed",
	);
	assert(capState.get() === 1_000, "failed fallback lowered the learned cap");
});

Deno.test("direct upload cap starts at 1.9 GB and concurrent reductions keep the minimum", async () => {
	const state = new DirectUploadCapState();
	assert(
		state.get() === TELEGRAM_DOCUMENT_MAX_BYTES,
		"fresh state used the wrong cap",
	);
	await Promise.all([
		Promise.resolve().then(() => state.publishSuccessfulFallback(500)),
		Promise.resolve().then(() => state.publishSuccessfulFallback(100)),
		Promise.resolve().then(() => state.publishSuccessfulFallback(300)),
	]);
	assert(state.get() === 100, "concurrent reductions did not keep the minimum");
});
