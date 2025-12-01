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
		let binary = "";
		for (let i = 0; i < uint8Array.length; i++) {
			binary += String.fromCharCode(uint8Array[i]);
		}
		const base64 = btoa(binary);

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
	const ext = url.split(".").pop()?.toLowerCase() || "jpeg";
	if (ext === "jpg") return "JPEG";
	if (ext === "png") return "PNG";
	if (ext === "gif") return "GIF";
	if (ext === "webp") return "WEBP";
	return "JPEG";
}
