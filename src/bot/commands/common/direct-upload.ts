import type { EpubVolumeResult } from "../../../export/epub.ts";

export const TELEGRAM_DOCUMENT_MAX_BYTES = 1_900_000_000;
export const DOCUMENT_FALLBACK_CAPS = [
	500_000_000, 300_000_000, 100_000_000, 50_000_000, 40_000_000,
] as const;

export class DirectUploadCapState {
	#maxBytes: number;

	constructor(initialMaxBytes = TELEGRAM_DOCUMENT_MAX_BYTES) {
		this.#maxBytes = initialMaxBytes;
	}

	get(): number {
		return this.#maxBytes;
	}

	publishSuccessfulFallback(maxBytes: number): void {
		this.#maxBytes = Math.min(this.#maxBytes, maxBytes);
	}
}

export const directUploadCapState = new DirectUploadCapState();

export interface DirectEpubUploadResult {
	sentFiles: number;
	oversizedSectionIndexes: number[];
	undeliveredSectionIndexes: number[];
	deliveryFailed: boolean;
}

interface DirectEpubUploadOptions {
	fullData: Uint8Array;
	sectionCount: number;
	generateVolumes: (
		startSection: number,
		maxBytes: number,
	) => Promise<EpubVolumeResult>;
	uploadFull: () => Promise<void>;
	uploadVolume: (
		data: Uint8Array,
		volumeNumber: number,
		startSection: number,
		endSection: number,
	) => Promise<void>;
	capState?: DirectUploadCapState;
	fallbackCaps?: readonly number[];
}

export async function uploadEpubDirectly(
	options: DirectEpubUploadOptions,
): Promise<DirectEpubUploadResult> {
	const capState = options.capState ?? directUploadCapState;
	const fallbackCaps = options.fallbackCaps ?? DOCUMENT_FALLBACK_CAPS;
	const initialCap = capState.get();
	let sentFiles = 0;
	let nextVolumeNumber = 1;
	let remainingStart = 0;
	let uploadHasFailed = false;
	const oversized = new Set<number>();

	if (options.fullData.length <= initialCap) {
		try {
			await options.uploadFull();
			return {
				sentFiles: 1,
				oversizedSectionIndexes: [],
				undeliveredSectionIndexes: [],
				deliveryFailed: false,
			};
		} catch {
			uploadHasFailed = true;
		}
	}

	const firstCap =
		options.fullData.length > initialCap ? initialCap : undefined;
	const caps = [firstCap, ...fallbackCaps]
		.filter((cap): cap is number => cap !== undefined)
		.filter((cap, index, values) => values.indexOf(cap) === index)
		.filter((cap) => cap <= initialCap && cap < options.fullData.length)
		.sort((a, b) => b - a);

	for (const cap of caps) {
		if (remainingStart >= options.sectionCount) break;
		let generated: EpubVolumeResult;
		try {
			generated = await options.generateVolumes(remainingStart, cap);
		} catch {
			return {
				sentFiles,
				oversizedSectionIndexes: [...oversized].sort((a, b) => a - b),
				undeliveredSectionIndexes: sectionIndexes(
					remainingStart,
					options.sectionCount,
				),
				deliveryFailed: true,
			};
		}

		for (const index of generated.oversizedSectionIndexes) {
			oversized.add(index);
		}

		let failedStart: number | undefined;
		for (const volume of generated.volumes) {
			try {
				await options.uploadVolume(
					volume.data,
					nextVolumeNumber,
					volume.startSection,
					volume.endSection,
				);
				if (uploadHasFailed) capState.publishSuccessfulFallback(cap);
				sentFiles++;
				nextVolumeNumber++;
				remainingStart = volume.endSection;
			} catch {
				uploadHasFailed = true;
				failedStart = volume.startSection;
				remainingStart = failedStart;
				break;
			}
		}

		if (failedStart === undefined) {
			remainingStart = options.sectionCount;
			break;
		}
	}

	const undelivered =
		remainingStart < options.sectionCount
			? sectionIndexes(remainingStart, options.sectionCount)
			: [];
	return {
		sentFiles,
		oversizedSectionIndexes: [...oversized].sort((a, b) => a - b),
		undeliveredSectionIndexes: undelivered,
		deliveryFailed: undelivered.length > 0 || sentFiles === 0,
	};
}

function sectionIndexes(start: number, end: number): number[] {
	return Array.from(
		{ length: Math.max(0, end - start) },
		(_, index) => start + index,
	);
}
