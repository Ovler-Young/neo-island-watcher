/**
 * Sanitizes a string to be safe for use as a filename
 * Removes or replaces illegal characters and limits length
 */
export function sanitizeFilename(title: string): string {
	return title
		.replace(/[/\\:*?"<>|]/g, "_") // Replace illegal filename chars
		.replace(/\s+/g, " ") // Normalize spaces
		.trim()
		.slice(0, 100); // Limit length to prevent issues
}

/**
 * Generates a proper filename for a thread markdown export
 * Uses thread title if available, otherwise just the ID
 */
export function generateThreadFilename(
	threadId: string,
	title: string,
	variant?: "filtered" | "all",
	extension = "md",
): string {
	const suffix = variant === "all" ? "_all" : "";
	if (title && title !== "无标题") {
		const sanitized = sanitizeFilename(title);
		return `${sanitized}${suffix}.${extension}`;
	}
	return `thread_${threadId}${suffix}.${extension}`;
}
