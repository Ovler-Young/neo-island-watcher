/**
 * Download image and convert to base64 data URL
 */
export async function downloadImageAsBase64(
	url: string,
): Promise<string | null> {
	try {
		const response = await fetch(url);
		if (!response.ok) return null;

		const arrayBuffer = await response.arrayBuffer();
		const uint8Array = new Uint8Array(arrayBuffer);

		// Use chunk-based approach for better performance with large images
		const chunkSize = 8192;
		const chunks: string[] = [];
		for (let i = 0; i < uint8Array.length; i += chunkSize) {
			const chunk = uint8Array.subarray(i, i + chunkSize);
			chunks.push(String.fromCharCode(...chunk));
		}
		const base64 = btoa(chunks.join(""));

		const contentType = response.headers.get("content-type") || "image/jpeg";
		return `data:${contentType};base64,${base64}`;
	} catch (error) {
		console.error(`Failed to download image ${url}:`, error);
		return null;
	}
}

/**
 * Get image format from URL extension
 */
export function getImageFormat(url: string): string {
	// Parse URL to handle query parameters and fragments correctly
	let pathname: string;
	try {
		pathname = new URL(url).pathname;
	} catch {
		pathname = url;
	}
	const ext = pathname.split(".").pop()?.toLowerCase() || "jpeg";
	if (ext === "jpg") return "JPEG";
	if (ext === "png") return "PNG";
	if (ext === "gif") return "GIF";
	if (ext === "webp") return "WEBP";
	return "JPEG";
}
