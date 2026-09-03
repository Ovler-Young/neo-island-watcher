import { GrammyError } from "grammy";
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

function telegramError(code: number, description: string): GrammyError {
	return new GrammyError(
		"sendDocument failed",
		{ ok: false, error_code: code, description },
		"sendDocument",
		{},
	);
}

Deno.test("a successful full EPUB uploads once without lowering the cap", async () => {
	const capState = new DirectUploadCapState(1_000);
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
		uploadFull: () => Promise.resolve(),
		uploadVolume: () => Promise.resolve(),
	});

	assert(result.sentFiles === 1, "full EPUB was not counted");
	assert(volumeGenerations === 0, "volumes were generated unnecessarily");
	assert(capState.get() === 1_000, "successful full upload lowered the cap");
});

Deno.test("only a confirmed size rejection selects and learns a smaller cap", async () => {
	const capState = new DirectUploadCapState(1_000);
	const generated: Array<[number, number]> = [];
	const delivered: Array<[number, number]> = [];
	const result = await uploadEpubDirectly({
		fullData: new Uint8Array(900),
		sectionCount: 4,
		capState,
		fallbackCaps: [500, 300],
		generateVolumes: (start, cap) => {
			generated.push([start, cap]);
			return Promise.resolve(volumes([[start, 4]]));
		},
		uploadFull: () =>
			Promise.reject(telegramError(413, "Request Entity Too Large")),
		uploadVolume: (_data, _number, start, end) => {
			delivered.push([start, end]);
			return Promise.resolve();
		},
	});

	assert(generated.join(":") === "0,500", "wrong fallback cap was selected");
	assert(delivered.join(":") === "0,4", "fallback range was not delivered");
	assert(result.issues.length === 0, "recovered size failure was reported");
	assert(capState.get() === 500, "successful fallback cap was not learned");
});

Deno.test("size fallback regenerates only the failed and later range", async () => {
	const generated: Array<[number, number]> = [];
	const delivered: string[] = [];
	let failedOnce = false;
	const result = await uploadEpubDirectly({
		fullData: new Uint8Array(1_200),
		sectionCount: 6,
		capState: new DirectUploadCapState(1_000),
		fallbackCaps: [500],
		generateVolumes: (start, cap) => {
			generated.push([start, cap]);
			return Promise.resolve(
				cap === 1_000
					? volumes([
							[0, 2],
							[2, 6],
						])
					: volumes([
							[start, 4],
							[4, 6],
						]),
			);
		},
		uploadFull: () => Promise.resolve(),
		uploadVolume: (_data, _number, start, end) => {
			if (!failedOnce && start === 2) {
				failedOnce = true;
				return Promise.reject(telegramError(413, "Payload Too Large"));
			}
			delivered.push(`${start}:${end}`);
			return Promise.resolve();
		},
	});

	assert(generated.join("|") === "0,1000|2,500", "wrong range was regenerated");
	assert(
		delivered.join(",") === "0:2,2:4,4:6",
		"a successful range was resent",
	);
	assert(result.issues.length === 0, "recovered partial failure was reported");
});

Deno.test("non-size full upload failures do not select fallback or lower cap", async () => {
	const capState = new DirectUploadCapState(1_000);
	let generated = false;
	const result = await uploadEpubDirectly({
		fullData: new Uint8Array(900),
		sectionCount: 5,
		fullFilename: "thread.epub",
		capState,
		fallbackCaps: [500],
		generateVolumes: () => {
			generated = true;
			return Promise.resolve(volumes([]));
		},
		uploadFull: () => Promise.reject(telegramError(401, "Unauthorized")),
		uploadVolume: () => Promise.resolve(),
	});

	assert(!generated, "an unrelated Telegram error selected size fallback");
	assert(capState.get() === 1_000, "an unrelated error lowered the cap");
	assert(result.issues.length === 1, "full upload issue was not recorded");
	assert(result.issues[0].category === "telegram_api", "wrong issue category");
	assert(result.issues[0].filename === "thread.epub", "filename was omitted");
	assert(result.issues[0].startSection === 0, "full range start was lost");
	assert(result.issues[0].endSection === 5, "full range end was lost");
});

Deno.test("one non-size volume failure records its range and continues later volumes", async () => {
	const delivered: string[] = [];
	const result = await uploadEpubDirectly({
		fullData: new Uint8Array(500),
		sectionCount: 6,
		capState: new DirectUploadCapState(300),
		fallbackCaps: [100],
		generateVolumes: () =>
			Promise.resolve(
				volumes([
					[0, 2],
					[2, 4],
					[4, 6],
				]),
			),
		uploadFull: () => Promise.resolve(),
		uploadVolume: (_data, number, start, end) => {
			if (start === 2) return Promise.reject(new SyntaxError("proxy HTML"));
			delivered.push(`${number}:${start}:${end}`);
			return Promise.resolve();
		},
		volumeFilename: (number) => `volume-${number}.epub`,
	});

	assert(
		delivered.join(",") === "1:0:2,3:4:6",
		"later volume did not continue",
	);
	assert(result.issues[0].startSection === 2, "failure range start was lost");
	assert(result.issues[0].endSection === 4, "failure range end was lost");
	assert(
		result.issues[0].category === "invalid_response",
		"failure was misclassified",
	);
	assert(
		result.issues[0].filename === "volume-2.epub",
		"failed volume identity was omitted",
	);
});

Deno.test("a lowest-cap size failure records only its range and continues", async () => {
	const delivered: string[] = [];
	const result = await uploadEpubDirectly({
		fullData: new Uint8Array(500),
		sectionCount: 6,
		capState: new DirectUploadCapState(300),
		fallbackCaps: [],
		generateVolumes: () =>
			Promise.resolve(
				volumes([
					[0, 2],
					[2, 4],
					[4, 6],
				]),
			),
		uploadFull: () => Promise.resolve(),
		uploadVolume: (_data, _number, start, end) => {
			if (start === 2) {
				return Promise.reject(telegramError(400, "File is too large"));
			}
			delivered.push(`${start}:${end}`);
			return Promise.resolve();
		},
	});

	assert(
		delivered.join(",") === "0:2,4:6",
		"later lowest-cap volume was skipped",
	);
	assert(result.issues[0].startSection === 2, "size range start was lost");
	assert(result.issues[0].endSection === 4, "size range end was lost");
	assert(
		result.issues[0].category === "size_rejection",
		"size category was lost",
	);
});

Deno.test("generation failures remain distinct from delivery failures", async () => {
	const result = await uploadEpubDirectly({
		fullData: new Uint8Array(500),
		sectionCount: 4,
		capState: new DirectUploadCapState(300),
		fallbackCaps: [],
		generateVolumes: () => Promise.reject(new Error("pandoc details")),
		uploadFull: () => Promise.resolve(),
		uploadVolume: () => Promise.resolve(),
	});

	assert(
		result.issues.length === 1,
		"generation failure was not recorded once",
	);
	assert(
		result.issues[0].kind === "generation",
		"generation failure was not marked",
	);
	assert(
		result.issues[0].category === "conversion",
		"wrong generation category",
	);
	assert(!("message" in result.issues[0]), "raw conversion error leaked");
});

Deno.test("indivisible chapters are structured while adjacent volumes continue", async () => {
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
		uploadFull: () => Promise.resolve(),
		uploadVolume: (_data, _number, start, end) => {
			delivered.push(`${start}:${end}`);
			return Promise.resolve();
		},
	});

	assert(delivered.join(",") === "0:1,2:3", "adjacent volumes were omitted");
	assert(result.issues[0].startSection === 1, "oversized range start was lost");
	assert(result.issues[0].endSection === 2, "oversized range end was lost");
	assert(
		result.issues[0].kind === "oversized_section",
		"oversized issue was not structured",
	);
});

Deno.test("direct upload cap starts at 1.9 GB and reductions keep the minimum", () => {
	const state = new DirectUploadCapState();
	assert(
		state.get() === TELEGRAM_DOCUMENT_MAX_BYTES,
		"fresh state used the wrong cap",
	);
	state.publishSuccessfulFallback(500);
	state.publishSuccessfulFallback(100);
	state.publishSuccessfulFallback(300);
	assert(state.get() === 100, "reductions did not keep the minimum");
});
