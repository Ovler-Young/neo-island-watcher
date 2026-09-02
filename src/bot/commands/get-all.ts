import type { Context } from "grammy";

import { generateEpub } from "../../export/epub.ts";
import { generatePdf } from "../../export/pdf.ts";
import { SplitZipWriter } from "../../export/zip.ts";
import { groupBindings } from "../../storage/group-bindings.ts";
import { generateThreadFilename } from "../../utils/filename.ts";
import { uploadArchivesAdaptively } from "./common/archive-upload.ts";
import { fetchThreadById } from "./common/fetch-thread.ts";
import { sendDocumentFromPath } from "./common/file-utils.ts";
import { createStatusUpdater } from "./common/status-updater.ts";

export type BatchExportFormat = "md" | "pdf" | "epub";

const ALL_FORMATS: BatchExportFormat[] = ["md", "pdf", "epub"];
const encoder = new TextEncoder();
const TEMP_DIR = "data/temp";

export type BatchRequest =
	| { kind: "single" }
	| { kind: "batch"; formats: BatchExportFormat[] }
	| { kind: "invalid-batch" };

export function parseGetBatchRequest(match: unknown): BatchRequest {
	const args = String(match ?? "")
		.trim()
		.toLowerCase()
		.split(/\s+/);
	if (args[0] !== "all") {
		return { kind: "single" };
	}
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
}

async function generateExport(
	title: string,
	variant: ExportVariant,
	format: BatchExportFormat,
): Promise<Uint8Array | null> {
	if (format === "md") {
		return encoder.encode(variant.markdown);
	}
	return format === "pdf"
		? await generatePdf(variant.markdown, title)
		: await generateEpub(variant.markdown, title);
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

	const archive = new SplitZipWriter(TEMP_DIR);
	let added = 0;
	let unavailable = 0;
	let oversized = 0;
	let failedThreads = 0;

	try {
		for (const [index, threadId] of threadIds.entries()) {
			const result = await fetchThreadById(
				ctx,
				threadId,
				`Getting thread ${index + 1}/${threadIds.length}:`,
			);
			if (!result) {
				failedThreads++;
				continue;
			}

			const updater = createStatusUpdater(ctx.api, chatId, result.statusMsg);
			try {
				const variants: ExportVariant[] = [
					{ name: "filtered", markdown: result.filteredMarkdown },
				];
				if (result.allMarkdown) {
					variants.push({ name: "all", markdown: result.allMarkdown });
				}

				for (const variant of variants) {
					for (const format of formats) {
						await updater?.forceUpdate(
							`📦 Exporting ${threadId} (${variant.name} ${format.toUpperCase()})...`,
						);
						let data: Uint8Array | null;
						try {
							data = await generateExport(result.title, variant, format);
						} catch (error) {
							console.error(
								`Failed to export ${threadId} as ${format}:`,
								error,
							);
							unavailable++;
							continue;
						}
						if (!data) {
							unavailable++;
							continue;
						}

						const filename = generateThreadFilename(
							threadId,
							result.title,
							variant.name,
							format,
						);
						if (await archive.add(`${threadId}/${filename}`, data)) {
							added++;
						} else {
							oversized++;
						}
					}
				}
			} finally {
				await updater?.delete();
			}
		}

		const archives = await archive.finish();
		if (archives.length === 0 || added === 0) {
			const reasons: string[] = [];
			if (unavailable > 0) reasons.push("the requested conversions failed");
			if (oversized > 0) reasons.push("the generated files were too large");
			if (failedThreads > 0) {
				reasons.push("the bound threads could not be fetched");
			}
			const toolingHint =
				unavailable > 0 &&
				formats.some((format) => format === "pdf" || format === "epub")
					? " PDF and EPUB require Pandoc and their configured conversion tools."
					: "";
			await ctx.reply(
				`❌ No export files could be archived${
					reasons.length > 0 ? ` because ${reasons.join(" and ")}` : ""
				}.${toolingHint}`,
			);
			return;
		}

		const uploadResult = await uploadArchivesAdaptively(
			{ archives, cleanup: () => archive.cleanup() },
			TEMP_DIR,
			`chat_${chatId}_threads`,
			{
				upload: (item, filename) =>
					sendDocumentFromPath(ctx, item.path, filename),
				replyFailure: async (remainingEntries, omittedEntries) => {
					const omitted =
						omittedEntries > 0
							? ` ${omittedEntries} additional exports could not fit the smaller archive limit.`
							: "";
					await ctx.reply(
						`❌ Archive upload failed even after smaller parts; ${remainingEntries} exports could not be delivered.${omitted}`,
					);
				},
			},
		);
		oversized += uploadResult.omittedEntries.length;
		if (uploadResult.uploadFailed) return;

		const omissions: string[] = [];
		if (unavailable > 0) {
			omissions.push(`${unavailable} exports unavailable`);
		}
		if (oversized > 0) {
			omissions.push(
				`${oversized} exports could not fit an archive size limit`,
			);
		}
		if (failedThreads > 0) {
			omissions.push(`${failedThreads} threads could not be fetched`);
		}
		if (omissions.length > 0) {
			await ctx.reply(`⚠️ Archive completed with ${omissions.join(", ")}.`);
		}
	} finally {
		await archive.cleanup();
	}
}
