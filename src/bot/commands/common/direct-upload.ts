import type { EpubVolumeResult } from "../../../export/epub.ts";
import {
	type ClassifiedDeliveryError,
	classifyDeliveryError,
	type DeliveryErrorCategory,
} from "../../telegram-response.ts";

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

export interface DirectEpubDeliveryIssue {
	kind: "delivery" | "generation" | "oversized_section";
	category: DeliveryErrorCategory;
	startSection: number;
	endSection: number;
	filename?: string;
	volumeNumber?: number;
	status?: number;
	code?: number;
}

export interface DirectEpubUploadResult {
	sentFiles: number;
	issues: DirectEpubDeliveryIssue[];
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
	fullFilename?: string;
	volumeFilename?: (volumeNumber: number) => string;
	capState?: DirectUploadCapState;
	fallbackCaps?: readonly number[];
}

export async function uploadEpubDirectly(
	options: DirectEpubUploadOptions,
): Promise<DirectEpubUploadResult> {
	const capState = options.capState ?? directUploadCapState;
	const fallbackCaps = options.fallbackCaps ?? DOCUMENT_FALLBACK_CAPS;
	const initialCap = capState.get();
	const issues: DirectEpubDeliveryIssue[] = [];
	let sentFiles = 0;
	let nextVolumeNumber = 1;
	let remainingStart = 0;
	let confirmedSizeFailure = false;
	let fullSizeFailure: ClassifiedDeliveryError | undefined;

	if (options.fullData.length <= initialCap) {
		try {
			await options.uploadFull();
			return buildResult(1, issues);
		} catch (error) {
			const classified = classifyDeliveryError(error);
			if (classified.category !== "size_rejection") {
				issues.push({
					kind: "delivery",
					...classified,
					startSection: 0,
					endSection: options.sectionCount,
					filename: options.fullFilename,
				});
				return buildResult(0, issues);
			}
			confirmedSizeFailure = true;
			fullSizeFailure = classified;
		}
	}

	const firstCap =
		options.fullData.length > initialCap ? initialCap : undefined;
	const caps = [firstCap, ...fallbackCaps]
		.filter((cap): cap is number => cap !== undefined)
		.filter((cap, index, values) => values.indexOf(cap) === index)
		.filter((cap) => cap <= initialCap && cap < options.fullData.length)
		.sort((a, b) => b - a);

	if (caps.length === 0 && confirmedSizeFailure) {
		issues.push({
			kind: "delivery",
			...(fullSizeFailure ?? { category: "size_rejection" }),
			startSection: 0,
			endSection: options.sectionCount,
			filename: options.fullFilename,
		});
	}

	for (const [capIndex, cap] of caps.entries()) {
		if (remainingStart >= options.sectionCount) break;
		let generated: EpubVolumeResult;
		try {
			generated = await options.generateVolumes(remainingStart, cap);
		} catch (error) {
			issues.push({
				kind: "generation",
				...classifyDeliveryError(error, "conversion"),
				startSection: remainingStart,
				endSection: options.sectionCount,
			});
			break;
		}

		let retryFrom: number | undefined;
		for (const volume of generated.volumes) {
			const volumeNumber = nextVolumeNumber;
			try {
				await options.uploadVolume(
					volume.data,
					volumeNumber,
					volume.startSection,
					volume.endSection,
				);
				if (confirmedSizeFailure) {
					capState.publishSuccessfulFallback(cap);
					confirmedSizeFailure = false;
				}
				sentFiles++;
				nextVolumeNumber++;
				remainingStart = Math.max(remainingStart, volume.endSection);
			} catch (error) {
				const classified = classifyDeliveryError(error);
				const hasSmallerCap = capIndex + 1 < caps.length;
				if (classified.category === "size_rejection" && hasSmallerCap) {
					confirmedSizeFailure = true;
					retryFrom = volume.startSection;
					remainingStart = retryFrom;
					break;
				}

				issues.push({
					kind: "delivery",
					...classified,
					startSection: volume.startSection,
					endSection: volume.endSection,
					filename: options.volumeFilename?.(volumeNumber),
					volumeNumber,
				});
				nextVolumeNumber++;
				remainingStart = Math.max(remainingStart, volume.endSection);
			}
		}

		for (const index of generated.oversizedSectionIndexes) {
			if (retryFrom !== undefined && index >= retryFrom) continue;
			issues.push({
				kind: "oversized_section",
				category: "size_rejection",
				startSection: index,
				endSection: index + 1,
			});
		}

		if (retryFrom !== undefined) continue;
		remainingStart = options.sectionCount;
		break;
	}

	return buildResult(sentFiles, issues);
}

function buildResult(
	sentFiles: number,
	issues: DirectEpubDeliveryIssue[],
): DirectEpubUploadResult {
	return { sentFiles, issues };
}
