import type { Context } from "grammy";

import { generateEpub, generateEpubVolumes } from "../../export/epub.ts";
import { generatePdf } from "../../export/pdf.ts";
import { groupBindings } from "../../storage/group-bindings.ts";
import { generateThreadFilename } from "../../utils/filename.ts";
import {
	directUploadCapState,
	uploadEpubDirectly,
} from "./common/direct-upload.ts";
import { fetchThreadById } from "./common/fetch-thread.ts";
import { sendDocument } from "./common/file-utils.ts";
import { createStatusUpdater } from "./common/status-updater.ts";

export type BatchExportFormat = "md" | "pdf" | "epub";

const ALL_FORMATS: BatchExportFormat[] = ["md", "pdf", "epub"];
const encoder = new TextEncoder();

export type BatchRequest =
	| { kind: "single" }
	| { kind: "batch"; formats: BatchExportFormat[] }
	| { kind: "invalid-batch" };

export function parseGetBatchRequest(match: unknown): BatchRequest {
	const args = String(match ?? "")
		.trim()
		.toLowerCase()
		.split(/\s+/);
	if (args[0] !== "all") return { kind: "single" };
	if (args.length === 1) {
		return { kind: "batch", formats: [...ALL_FORMATS] };
	}
	if (
		args.length === 2 &&
		(args[1] === "md" || args[1] === "pdf" || args[1] === "epub")
	) {
		return { kind: "batch", formats: [args[1]] };
	}
	return { kind: "invalid-batch" };
}

interface ExportVariant {
	name: "filtered" | "all";
	markdown: string;
	preamble: string;
	sections: string[];
}

interface DeliveryCounts {
	sent: number;
	unavailable: number;
	tooLarge: number;
	deliveryFailed: number;
	failedThreads: number;
	oversizedChapters: number;
	undeliveredChapters: number;
}

function directFilename(
	threadId: string,
	title: string,
	variant: ExportVariant["name"],
	format: BatchExportFormat,
): string {
	return `${threadId}_${generateThreadFilename(
		threadId,
		title,
		variant,
		format,
	)}`;
}

function caption(
	threadId: string,
	variant: ExportVariant["name"],
	format: BatchExportFormat,
	volume?: number,
): string {
	const base = `${threadId} · ${variant} · ${format.toUpperCase()}`;
	return volume === undefined ? base : `${base} · volume ${volume}`;
}

async function deliverFlatExport(
	ctx: Context,
	threadId: string,
	title: string,
	variant: ExportVariant,
	format: Exclude<BatchExportFormat, "epub">,
	counts: DeliveryCounts,
): Promise<void> {
	const data =
		format === "md"
			? encoder.encode(variant.markdown)
			: await generatePdf(variant.markdown, title);
	if (!data) {
		counts.unavailable++;
		return;
	}
	if (data.length > directUploadCapState.get()) {
		counts.tooLarge++;
		return;
	}

	try {
		await sendDocument(
			ctx,
			data,
			directFilename(threadId, title, variant.name, format),
			caption(threadId, variant.name, format),
		);
		counts.sent++;
	} catch {
		counts.deliveryFailed++;
	}
}

async function deliverEpub(
	ctx: Context,
	threadId: string,
	title: string,
	variant: ExportVariant,
	counts: DeliveryCounts,
): Promise<void> {
	const data = await generateEpub(variant.markdown, title);
	if (!data) {
		counts.unavailable++;
		return;
	}

	const filename = directFilename(threadId, title, variant.name, "epub");
	const baseName = filename.slice(0, -".epub".length);
	const result = await uploadEpubDirectly({
		fullData: data,
		sectionCount: variant.sections.length,
		generateVolumes: (startSection, maxBytes) =>
			generateEpubVolumes(
				variant.preamble,
				variant.sections.slice(startSection),
				title,
				maxBytes,
				undefined,
				startSection,
			),
		uploadFull: () =>
			sendDocument(
				ctx,
				data,
				filename,
				caption(threadId, variant.name, "epub"),
			),
		uploadVolume: (volume, volumeNumber) =>
			sendDocument(
				ctx,
				volume,
				`${baseName}_volume_${String(volumeNumber).padStart(3, "0")}.epub`,
				caption(threadId, variant.name, "epub", volumeNumber),
			),
	});
	counts.sent += result.sentFiles;
	counts.oversizedChapters += result.oversizedSectionIndexes.length;
	counts.undeliveredChapters += result.undeliveredSectionIndexes.length;
	if (result.deliveryFailed) counts.deliveryFailed++;
}

export async function handleGetAll(
	ctx: Context,
	formats: BatchExportFormat[],
): Promise<void> {
	const chatId = ctx.chat?.id;
	if (!chatId) {
		await ctx.reply("❌ No chat found");
		return;
	}

	const binding = await groupBindings.getGroupBinding(chatId.toString());
	const threadIds = Object.keys(binding?.topics ?? {}).sort(
		(a, b) => Number(a) - Number(b),
	);
	if (threadIds.length === 0) {
		await ctx.reply("❌ No threads are bound to this chat.");
		return;
	}

	const counts: DeliveryCounts = {
		sent: 0,
		unavailable: 0,
		tooLarge: 0,
		deliveryFailed: 0,
		failedThreads: 0,
		oversizedChapters: 0,
		undeliveredChapters: 0,
	};

	for (const [index, threadId] of threadIds.entries()) {
		const result = await fetchThreadById(
			ctx,
			threadId,
			`Getting thread ${index + 1}/${threadIds.length}:`,
		);
		if (!result) {
			counts.failedThreads++;
			continue;
		}

		const updater = createStatusUpdater(ctx.api, chatId, result.statusMsg);
		try {
			const variants: ExportVariant[] = [
				{
					name: "filtered",
					markdown: result.filteredMarkdown,
					preamble: result.filteredPreamble,
					sections: result.filteredSections,
				},
			];
			if (result.allMarkdown && result.allPreamble && result.allSections) {
				variants.push({
					name: "all",
					markdown: result.allMarkdown,
					preamble: result.allPreamble,
					sections: result.allSections,
				});
			}

			for (const variant of variants) {
				for (const format of formats) {
					try {
						await updater?.forceUpdate(
							`📦 Exporting ${threadId} (${variant.name} ${format.toUpperCase()})...`,
						);
						if (format === "epub") {
							await deliverEpub(ctx, threadId, result.title, variant, counts);
						} else {
							await deliverFlatExport(
								ctx,
								threadId,
								result.title,
								variant,
								format,
								counts,
							);
						}
					} catch (error) {
						console.error(
							`Failed to export or deliver ${threadId} as ${variant.name} ${format}:`,
							error,
						);
						counts.unavailable++;
					}
				}
			}
		} finally {
			await updater?.delete();
		}
	}

	const notes: string[] = [];
	if (counts.unavailable > 0) notes.push(`${counts.unavailable} unavailable`);
	if (counts.tooLarge > 0) notes.push(`${counts.tooLarge} too large`);
	if (counts.deliveryFailed > 0) {
		notes.push(`${counts.deliveryFailed} delivery failures`);
	}
	if (counts.failedThreads > 0) {
		notes.push(`${counts.failedThreads} threads could not be fetched`);
	}
	if (counts.oversizedChapters > 0) {
		notes.push(
			`${counts.oversizedChapters} indivisible EPUB chapters too large`,
		);
	}
	if (counts.undeliveredChapters > 0) {
		notes.push(`${counts.undeliveredChapters} EPUB chapters undelivered`);
	}

	if (counts.sent === 0) {
		await ctx.reply(
			`❌ No export files were delivered${
				notes.length > 0 ? `: ${notes.join(", ")}` : ""
			}.`,
		);
	} else if (notes.length > 0) {
		await ctx.reply(`⚠️ Export delivery completed with ${notes.join(", ")}.`);
	}
}
