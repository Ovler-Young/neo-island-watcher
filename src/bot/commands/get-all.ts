import type { Context } from "grammy";

import { generateEpub, generateEpubVolumes } from "../../export/epub.ts";
import { generatePdf } from "../../export/pdf.ts";
import { groupBindings } from "../../storage/group-bindings.ts";
import { generateThreadFilename } from "../../utils/filename.ts";
import { classifyDeliveryError } from "../telegram-response.ts";
import {
	type DirectEpubDeliveryIssue,
	directUploadCapState,
	uploadEpubDirectly,
} from "./common/direct-upload.ts";
import {
	attachPostRange,
	buildDeliveryReport,
	deliverMarkdownFallbacks,
	type ExportDeliveryIssue,
	type ExportVariantName,
	isRangeCovered,
	mergeSectionRanges,
} from "./common/export-delivery.ts";
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
	name: ExportVariantName;
	markdown: string;
	preamble: string;
	sections: string[];
	postIds: string[];
}

type MarkdownDelivery = "not_requested" | "delivered" | "failed";

interface DeliveryState {
	sent: number;
	issues: ExportDeliveryIssue[];
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
	state: DeliveryState,
): Promise<boolean> {
	const filename = directFilename(threadId, title, variant.name, format);
	let data: Uint8Array | null;
	try {
		data =
			format === "md"
				? encoder.encode(variant.markdown)
				: await generatePdf(variant.markdown, title);
	} catch {
		state.issues.push(
			fullRangeIssue(threadId, variant, format, "conversion", filename),
		);
		return false;
	}
	if (!data) {
		state.issues.push(
			fullRangeIssue(threadId, variant, format, "unavailable", filename),
		);
		return false;
	}
	if (data.length > directUploadCapState.get()) {
		state.issues.push(
			fullRangeIssue(threadId, variant, format, "too_large", filename),
		);
		return false;
	}

	try {
		await sendDocument(
			ctx,
			data,
			filename,
			caption(threadId, variant.name, format),
		);
		state.sent++;
		return true;
	} catch (error) {
		state.issues.push(
			fullRangeIssue(
				threadId,
				variant,
				format,
				classifyDeliveryError(error).category,
				filename,
			),
		);
		return false;
	}
}

async function deliverEpub(
	ctx: Context,
	threadId: string,
	title: string,
	variant: ExportVariant,
	markdownDelivery: MarkdownDelivery,
	state: DeliveryState,
): Promise<void> {
	const filename = directFilename(threadId, title, variant.name, "epub");
	const baseName = filename.slice(0, -".epub".length);
	let data: Uint8Array | null;
	let generationFailed = false;
	try {
		data = await generateEpub(variant.markdown, title);
	} catch {
		data = null;
		generationFailed = true;
	}

	let epubIssues: ExportDeliveryIssue[];
	if (!data) {
		epubIssues = [
			fullRangeIssue(
				threadId,
				variant,
				"epub",
				generationFailed ? "generation_failure" : "unavailable",
				filename,
			),
		];
	} else {
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
			fullFilename: filename,
			volumeFilename: (volumeNumber) =>
				`${baseName}_volume_${String(volumeNumber).padStart(3, "0")}.epub`,
		});
		state.sent += result.sentFiles;
		epubIssues = result.issues.map((issue) =>
			mapEpubIssue(threadId, variant, filename, issue),
		);
	}

	if (epubIssues.length === 0) return;
	await deliverEpubFallback(
		ctx,
		threadId,
		variant,
		markdownDelivery,
		baseName,
		epubIssues,
		state,
	);
}

async function deliverEpubFallback(
	ctx: Context,
	threadId: string,
	variant: ExportVariant,
	markdownDelivery: MarkdownDelivery,
	baseFilename: string,
	epubIssues: ExportDeliveryIssue[],
	state: DeliveryState,
): Promise<void> {
	const fallback = await deliverMarkdownFallbacks({
		threadId,
		variant: variant.name,
		preamble: variant.preamble,
		sections: variant.sections,
		postIds: variant.postIds,
		ranges: mergeSectionRanges(epubIssues),
		maxBytes: directUploadCapState.get(),
		baseFilename,
		fullMarkdownDelivered: markdownDelivery === "delivered",
		send: (fallbackData, fallbackFilename, fallbackCaption) =>
			sendDocument(ctx, fallbackData, fallbackFilename, fallbackCaption),
	});
	state.sent += fallback.sentFiles;
	for (const issue of epubIssues) {
		if (isRangeCovered(issue, fallback.coveredRanges)) {
			issue.fallback = fallback.coverage;
		} else if (
			fallback.coveredRanges.some((range) => rangesOverlap(issue, range))
		) {
			issue.fallback = "partial";
		} else {
			issue.fallback = "failed";
		}
	}
	state.issues.push(...epubIssues, ...fallback.issues);
}

function fullRangeIssue(
	threadId: string,
	variant: ExportVariant,
	format: BatchExportFormat,
	category: ExportDeliveryIssue["category"],
	artifact: string,
): ExportDeliveryIssue {
	return attachPostRange(
		{
			threadId,
			variant: variant.name,
			format,
			category,
			artifact,
			startSection: 0,
			endSection: variant.sections.length,
		},
		variant.postIds,
	);
}

function mapEpubIssue(
	threadId: string,
	variant: ExportVariant,
	defaultFilename: string,
	issue: DirectEpubDeliveryIssue,
): ExportDeliveryIssue {
	return attachPostRange(
		{
			threadId,
			variant: variant.name,
			format: "epub",
			category:
				issue.kind === "generation" ? "generation_failure" : issue.category,
			artifact:
				issue.filename ??
				(issue.volumeNumber !== undefined
					? `epub-volume-${issue.volumeNumber}`
					: issue.kind === "generation"
						? "epub-volume-generation"
						: issue.kind === "oversized_section"
							? "epub-section"
							: defaultFilename),
			startSection: issue.startSection,
			endSection: issue.endSection,
		},
		variant.postIds,
	);
}

function rangesOverlap(
	a: ExportDeliveryIssue,
	b: { startSection: number; endSection: number },
): boolean {
	return a.startSection < b.endSection && b.startSection < a.endSection;
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

	const state: DeliveryState = { sent: 0, issues: [] };

	for (const [index, threadId] of threadIds.entries()) {
		const result = await fetchThreadById(
			ctx,
			threadId,
			`Getting thread ${index + 1}/${threadIds.length}:`,
		);
		if (!result) {
			for (const format of formats) {
				state.issues.push({
					threadId,
					variant: "filtered",
					format,
					category: "thread_fetch",
					artifact: "thread",
					startSection: 0,
					endSection: 0,
				});
			}
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
					postIds: result.filteredSectionPostIds,
				},
			];
			if (
				result.allMarkdown &&
				result.allPreamble &&
				result.allSections &&
				result.allSectionPostIds
			) {
				variants.push({
					name: "all",
					markdown: result.allMarkdown,
					preamble: result.allPreamble,
					sections: result.allSections,
					postIds: result.allSectionPostIds,
				});
			}

			for (const variant of variants) {
				let markdownDelivery: MarkdownDelivery = formats.includes("md")
					? "failed"
					: "not_requested";
				for (const format of formats) {
					try {
						await updater?.forceUpdate(
							`📦 Exporting ${threadId} (${variant.name} ${format.toUpperCase()})...`,
						);
						if (format === "epub") {
							await deliverEpub(
								ctx,
								threadId,
								result.title,
								variant,
								markdownDelivery,
								state,
							);
						} else {
							const delivered = await deliverFlatExport(
								ctx,
								threadId,
								result.title,
								variant,
								format,
								state,
							);
							if (format === "md") {
								markdownDelivery = delivered ? "delivered" : "failed";
							}
						}
					} catch (error) {
						const category = classifyDeliveryError(
							error,
							"conversion",
						).category;
						console.error(
							`Unexpected ${format} export failure for ${threadId} (${variant.name}); category=${category}`,
						);
						const issue = fullRangeIssue(
							threadId,
							variant,
							format,
							category,
							directFilename(threadId, result.title, variant.name, format),
						);
						if (format === "epub") {
							await deliverEpubFallback(
								ctx,
								threadId,
								variant,
								markdownDelivery,
								directFilename(
									threadId,
									result.title,
									variant.name,
									"epub",
								).slice(0, -".epub".length),
								[issue],
								state,
							);
						} else {
							state.issues.push(issue);
						}
					}
				}
			}
		} finally {
			await updater?.delete();
		}
	}

	for (const message of buildDeliveryReport(state.sent, state.issues)) {
		await ctx.reply(message);
	}
}
