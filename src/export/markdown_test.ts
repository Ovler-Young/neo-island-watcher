import { renderThreadMarkdown } from "./markdown-document.ts";

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

Deno.test("renderThreadMarkdown preserves formatter sections exactly", () => {
	const preamble = "# Thread\n\n";
	const sections = ["original\n\n---\n\nuser rule", "reply"];
	const markdown = renderThreadMarkdown(preamble, sections);

	assert(
		markdown ===
			"# Thread\n\noriginal\n\n---\n\nuser rule\n\n---\n\nreply\n\n---\n\n",
		"markdown assembly changed",
	);
	assert(
		sections.length === 2,
		"user horizontal rule changed section identity",
	);
});
