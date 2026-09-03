import { renderThreadMarkdown } from "../../../export/markdown-document.ts";
import {
	buildDeliveryReport,
	deliverMarkdownFallbacks,
	type ExportDeliveryIssue,
	mergeSectionRanges,
} from "./export-delivery.ts";

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

Deno.test("adjacent EPUB issue ranges merge without expanding section indexes", () => {
	const merged = mergeSectionRanges([
		{ startSection: 4000, endSection: 8153 },
		{ startSection: 10, endSection: 20 },
		{ startSection: 20, endSection: 30 },
	]);
	assert(merged.length === 2, "adjacent ranges were not merged");
	assert(merged[0].startSection === 10, "merged range start changed");
	assert(merged[0].endSection === 30, "merged range end changed");
	assert(merged[1].endSection === 8153, "large trailing range changed");
});

Deno.test("Markdown fallback repeats the preamble and splits only between sections", async () => {
	const preamble = "# Thread\n\n";
	const sections = ["first", "secon", "third"];
	const oneSectionBytes = new TextEncoder().encode(
		renderThreadMarkdown(preamble, [sections[0]]),
	).length;
	const sent: string[] = [];
	const result = await deliverMarkdownFallbacks({
		threadId: "123",
		variant: "all",
		preamble,
		sections,
		postIds: ["100", "101", "102"],
		ranges: [{ startSection: 0, endSection: 3 }],
		maxBytes: oneSectionBytes,
		baseFilename: "123_all",
		send: (data) => {
			sent.push(new TextDecoder().decode(data));
			return Promise.resolve();
		},
	});

	assert(sent.length === 3, "fallback did not split at section boundaries");
	assert(
		sent[1] === renderThreadMarkdown(preamble, [sections[1]]),
		"fallback content did not preserve the exact section",
	);
	assert(result.issues.length === 0, "successful fallback reported an issue");
	assert(result.coveredRanges.length === 1, "adjacent coverage was not merged");
});

Deno.test("successful full Markdown suppresses duplicate range fallback", async () => {
	let sends = 0;
	const result = await deliverMarkdownFallbacks({
		threadId: "321",
		variant: "filtered",
		preamble: "# Thread\n\n",
		sections: ["one", "two", "three"],
		postIds: ["10", "11", "12"],
		ranges: [
			{ startSection: 0, endSection: 2 },
			{ startSection: 1, endSection: 3 },
		],
		maxBytes: 100,
		baseFilename: "321_filtered",
		fullMarkdownDelivered: true,
		send: () => {
			sends++;
			return Promise.resolve();
		},
	});

	assert(sends === 0, "covered Markdown was sent again");
	assert(result.coverage === "full_markdown", "coverage source was lost");
	assert(result.coveredRanges.length === 1, "covered ranges were not merged");
});

Deno.test("oversized and failed Markdown fallback ranges do not stop later ranges", async () => {
	const sent: string[] = [];
	let attempt = 0;
	const fallbackCap = new TextEncoder().encode(
		renderThreadMarkdown("# T\n\n", ["short"]),
	).length;
	const result = await deliverMarkdownFallbacks({
		threadId: "456",
		variant: "filtered",
		preamble: "# T\n\n",
		sections: ["x".repeat(100), "short", "later"],
		postIds: ["200", "201", "202"],
		ranges: [
			{ startSection: 0, endSection: 1 },
			{ startSection: 1, endSection: 3 },
		],
		maxBytes: fallbackCap,
		baseFilename: "456_filtered",
		send: (data) => {
			attempt++;
			if (attempt === 1) return Promise.reject(new SyntaxError("proxy html"));
			sent.push(new TextDecoder().decode(data));
			return Promise.resolve();
		},
	});

	assert(result.issues.length === 2, "fallback failures were not distinct");
	assert(
		result.issues[0].category === "too_large",
		"oversize was misclassified",
	);
	assert(result.issues[0].firstPostId === "200", "oversized post was lost");
	assert(result.issues[1].startSection === 1, "send failure range was lost");
	assert(
		sent.length === 1 && sent[0].includes("later"),
		"later fallback stopped",
	);
});

Deno.test("delivery report keeps trailing failures as attributed ranges", () => {
	const issues: ExportDeliveryIssue[] = Array.from(
		{ length: 7 },
		(_, index) => ({
			threadId: String(7000 + index),
			variant: index % 2 === 0 ? "filtered" : "all",
			format: "epub",
			category: "invalid_response",
			artifact: `<html>/volume-${index}.epub?token=secret`,
			startSection: index === 0 ? 0 : 100,
			endSection: index === 0 ? 8153 : 200,
			firstPostId: String(9000 + index),
			lastPostId: String(9999 + index),
			fallback: "range_markdown",
		}),
	);
	const report = buildDeliveryReport(3, issues);
	const combined = report.join("\n");

	assert(
		combined.match(/^• /gm)?.length === 7,
		"seven failures did not remain seven issue records",
	);
	assert(
		combined.includes("chapters=1-8153"),
		"trailing range was expanded or lost",
	);
	assert(
		combined.includes("thread=7000 variant=filtered"),
		"identity was lost",
	);
	assert(combined.includes("variant=all"), "variant identity was collapsed");
	assert(!combined.includes("<html>"), "raw response text leaked");
	assert(!combined.includes("token=secret"), "artifact query leaked");
});

Deno.test("delivery report chunks many attributed issues below the reply limit", () => {
	const issues: ExportDeliveryIssue[] = Array.from(
		{ length: 40 },
		(_, index) => ({
			threadId: String(8000 + index),
			variant: "filtered",
			format: "epub",
			category: "invalid_response",
			artifact: `volume-${index}.epub`,
			startSection: 100,
			endSection: 200,
			firstPostId: String(9000 + index),
			lastPostId: String(9999 + index),
		}),
	);
	const report = buildDeliveryReport(3, issues);

	assert(report.length > 1, "long report was not chunked");
	assert(
		report.every((message) => message.length <= 3900),
		"report exceeded limit",
	);
});
