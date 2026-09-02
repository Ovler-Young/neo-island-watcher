import {
	repartitionZipArchives,
	type ZipArchive,
	type ZipArchiveBatch,
} from "../../../export/zip.ts";

export const ARCHIVE_FALLBACK_CAPS = [
	500_000_000, 300_000_000, 100_000_000, 50_000_000, 40_000_000,
];

interface ArchiveUploadHooks {
	upload: (archive: ZipArchive, filename: string) => Promise<void>;
	replyFailure: (
		remainingEntries: number,
		omittedEntries: number,
	) => Promise<void>;
	log?: (message: string) => void;
}

export interface ArchiveUploadResult {
	omittedEntries: string[];
	uploadFailed: boolean;
}

export async function uploadArchivesAdaptively(
	initialBatch: ZipArchiveBatch,
	directory: string,
	filenamePrefix: string,
	hooks: ArchiveUploadHooks,
	fallbackCaps: readonly number[] = ARCHIVE_FALLBACK_CAPS,
): Promise<ArchiveUploadResult> {
	let currentBatch = initialBatch;
	let remaining = [...currentBatch.archives];
	let fallbackIndex = 0;
	let nextPart = 1;
	const omittedEntries: string[] = [];
	const log = hooks.log ?? console.log;

	try {
		while (remaining.length > 0) {
			const archive = remaining[0];
			const filename = `${filenamePrefix}_part_${nextPart}.zip`;
			log(`Uploading archive ${filename} (${archive.size} bytes)`);
			try {
				await hooks.upload(archive, filename);
				remaining.shift();
				nextPart++;
				continue;
			} catch {
				// Escaping upload failures are handled by rebuilding only undelivered entries.
			}

			let nextCap: number | undefined;
			while (fallbackIndex < fallbackCaps.length) {
				const candidate = fallbackCaps[fallbackIndex++];
				if (candidate < archive.size) {
					nextCap = candidate;
					break;
				}
			}

			if (nextCap === undefined) {
				const remainingEntries = remaining.reduce(
					(total, item) => total + item.entries.length,
					0,
				);
				await hooks.replyFailure(remainingEntries, omittedEntries.length);
				return { omittedEntries, uploadFailed: true };
			}

			log(`Repartitioning remaining archives with cap ${nextCap} bytes`);
			const replacement = await repartitionZipArchives(
				remaining,
				directory,
				nextCap,
			);
			omittedEntries.push(...replacement.omittedEntries);
			await currentBatch.cleanup();
			currentBatch = replacement;
			remaining = [...replacement.archives];
		}

		return { omittedEntries, uploadFailed: false };
	} finally {
		await currentBatch.cleanup();
	}
}
