export function renderThreadMarkdown(
	preamble: string,
	sections: readonly string[],
): string {
	return `${preamble}${sections.join("\n\n---\n\n")}\n\n---\n\n`;
}
