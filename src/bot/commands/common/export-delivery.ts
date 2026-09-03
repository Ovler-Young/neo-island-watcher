import { renderThreadMarkdown } from "../../../export/markdown-document.ts";
import {
	classifyDeliveryError,
	type DeliveryErrorCategory,
} from "../../telegram-response.ts";

export type ExportVariantName = "filtered" | "all";
export type ExportFormat = "md" | "pdf" | "epub";

export interface SectionRange {
	startSection: number;
	endSection: number;
}

export interface ExportDeliveryIssue extends SectionRange {
	threadId: string;
	variant: ExportVariantName;
	format: ExportFormat;
	category:
		| DeliveryErrorCategory
		| "unavailable"
		| "generation_failure"
		| "too_large"
		| "thread_fetch";
	artifact: string;
	firstPostId?: string;
	lastPostId?: string;
	fallback?: "full_markdown" | "range_markdown" | "partial" | "failed";
}

interface MarkdownFallbackOptions {
	threadId: string;
	variant: ExportVariantName;
	preamble: string;
	sections: readonly string[];
	postIds: readonly string[];
	ranges: readonly SectionRange[];
	maxBytes: number;
	baseFilename: string;
	fullMarkdownDelivered?: boolean;
	send: (data: Uint8Array, filename: string, caption: string) => Promise<void>;
}

export interface MarkdownFallbackResult {
	sentFiles: number;
	issues: ExportDeliveryIssue[];
	coveredRanges: SectionRange[];
	coverage: "full_markdown" | "range_markdown";
}

const encoder = new TextEncoder();
const REPORT_LIMIT = 3900;

export function mergeSectionRanges(
	ranges: readonly SectionRange[],
): SectionRange[] {
	const sorted = ranges
		.filter((range) => range.endSection > range.startSection)
		.map((range) => ({ ...range }))
		.sort((a, b) => a.startSection - b.startSection);
	const merged: SectionRange[] = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (previous && range.startSection <= previous.endSection) {
			previous.endSection = Math.max(previous.endSection, range.endSection);
		} else {
			merged.push(range);
		}
	}
	return merged;
}

export async function deliverMarkdownFallbacks(
	options: MarkdownFallbackOptions,
): Promise<MarkdownFallbackResult> {
	if (options.fullMarkdownDelivered) {
		return {
			sentFiles: 0,
			issues: [],
			coveredRanges: mergeSectionRanges(options.ranges),
			coverage: "full_markdown",
		};
	}
	const issues: ExportDeliveryIssue[] = [];
	const coveredRanges: SectionRange[] = [];
	let sentFiles = 0;
	let partNumber = 1;

	for (const range of mergeSectionRanges(options.ranges)) {
		for (const part of splitMarkdownRange(options, range)) {
			const identity = rangeIdentity(part, options.postIds);
			const rangeLabel = chapterLabel(part);
			const filename = `${options.baseFilename}_epub_chapters_${rangeLabel}_fallback.md`;
			if (!part.data) {
				const { startSection, endSection } = part;
				issues.push({
					threadId: options.threadId,
					variant: options.variant,
					format: "md",
					category: "too_large",
					artifact: filename,
					startSection,
					endSection,
					...identity,
				});
				continue;
			}

			try {
				await options.send(
					part.data,
					filename,
					`${options.threadId} · ${options.variant} · EPUB fallback · chapters ${rangeLabel} · part ${partNumber}`,
				);
				sentFiles++;
				coveredRanges.push({
					startSection: part.startSection,
					endSection: part.endSection,
				});
			} catch (error) {
				const { startSection, endSection } = part;
				issues.push({
					threadId: options.threadId,
					variant: options.variant,
					format: "md",
					category: classifyDeliveryError(error).category,
					artifact: filename,
					startSection,
					endSection,
					...identity,
				});
			}
			partNumber++;
		}
	}

	return {
		sentFiles,
		issues,
		coveredRanges: mergeSectionRanges(coveredRanges),
		coverage: "range_markdown",
	};
}

function splitMarkdownRange(
	options: MarkdownFallbackOptions,
	range: SectionRange,
): Array<SectionRange & { data?: Uint8Array }> {
	const result: Array<SectionRange & { data?: Uint8Array }> = [];
	let start = range.startSection;
	while (start < range.endSection) {
		let low = start + 1;
		let high = range.endSection;
		let bestEnd: number | undefined;
		let bestData: Uint8Array | undefined;
		while (low <= high) {
			const middle = low + Math.floor((high - low) / 2);
			const data = encoder.encode(
				renderThreadMarkdown(
					options.preamble,
					options.sections.slice(start, middle),
				),
			);
			if (data.length <= options.maxBytes) {
				bestEnd = middle;
				bestData = data;
				low = middle + 1;
			} else {
				high = middle - 1;
			}
		}

		if (bestEnd === undefined || bestData === undefined) {
			result.push({ startSection: start, endSection: start + 1 });
			start++;
		} else {
			result.push({ startSection: start, endSection: bestEnd, data: bestData });
			start = bestEnd;
		}
	}
	return result;
}

export function attachPostRange(
	issue: Omit<ExportDeliveryIssue, "firstPostId" | "lastPostId">,
	postIds: readonly string[],
): ExportDeliveryIssue {
	return { ...issue, ...rangeIdentity(issue, postIds) };
}

export function isRangeCovered(
	range: SectionRange,
	coveredRanges: readonly SectionRange[],
): boolean {
	return coveredRanges.some(
		(covered) =>
			covered.startSection <= range.startSection &&
			covered.endSection >= range.endSection,
	);
}

export function buildDeliveryReport(
	sentFiles: number,
	issues: readonly ExportDeliveryIssue[],
): string[] {
	if (issues.length === 0) return [];
	const prefix =
		sentFiles === 0
			? `❌ No export files were delivered. ${issues.length} issue(s):`
			: `⚠️ Export delivery completed with ${issues.length} issue(s):`;
	const lines = issues.map(formatIssueLine);
	const messages: string[] = [];
	let current = prefix;
	for (const line of lines) {
		if (`${current}\n${line}`.length > REPORT_LIMIT) {
			messages.push(current);
			current = `⚠️ Export issues continued:\n${line}`;
		} else {
			current += `\n${line}`;
		}
	}
	messages.push(current);
	return messages;
}

function formatIssueLine(issue: ExportDeliveryIssue): string {
	const scope =
		issue.endSection > issue.startSection
			? ` chapters=${chapterLabel(issue)}`
			: "";
	const posts = issue.firstPostId
		? issue.firstPostId === issue.lastPostId
			? issue.firstPostId
			: `${issue.firstPostId ?? "?"}-${issue.lastPostId ?? "?"}`
		: "unknown";
	const fallback = issue.fallback ? ` fallback=${issue.fallback}` : "";
	return `• thread=${issue.threadId} variant=${issue.variant} format=${issue.format} category=${issue.category} artifact=${sanitizeArtifact(issue.artifact)}${scope} posts=${posts}${fallback}`;
}

function chapterLabel(range: SectionRange): string {
	const first = range.startSection + 1;
	const last = range.endSection;
	return first === last ? `${first}` : `${first}-${last}`;
}

function rangeIdentity(
	range: SectionRange,
	postIds: readonly string[],
): Pick<ExportDeliveryIssue, "firstPostId" | "lastPostId"> {
	return {
		firstPostId: postIds[range.startSection],
		lastPostId: postIds[range.endSection - 1],
	};
}

function sanitizeArtifact(artifact: string): string {
	const filename =
		artifact.split(/[\\/]/).at(-1)?.split(/[?#]/)[0] ?? "unknown";
	return filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160);
}
