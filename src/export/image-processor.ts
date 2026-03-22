import {
	ensureImageCached,
	type ImageCacheOptions,
} from "../storage/image-cache.ts";

export interface ImageProgress {
	phase: "downloading" | "converting";
	current: number;
	total: number;
}

function extractImageReferences(
	markdown: string,
): Array<{ fullMatch: string; alt: string; url: string; path: string }> {
	const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
	const images: Array<{
		fullMatch: string;
		alt: string;
		url: string;
		path: string;
	}> = [];

	for (const match of markdown.matchAll(imageRegex)) {
		const [fullMatch, alt, url] = match;
		// Extract path from URL (e.g., https://image.nmb.best/image/abc.jpg -> /image/abc.jpg)
		try {
			const urlObj = new URL(url);
			images.push({ fullMatch, alt, url, path: urlObj.pathname });
		} catch {
			// Skip invalid URLs
			console.warn(`Invalid image URL in markdown: ${url}`);
		}
	}

	return images;
}

export async function downloadAndReplaceImages(
	markdown: string,
	onProgress?: (progress: ImageProgress) => void,
	imageOptions?: ImageCacheOptions & { fallbackToLink?: boolean },
): Promise<string> {
	const images = extractImageReferences(markdown);

	console.log(`Found ${images.length} images in markdown`);

	if (images.length === 0) {
		return markdown;
	}

	// Download all images concurrently (with concurrency limit)
	const CONCURRENCY = 5;
	const pathMap = new Map<string, string>();

	console.log(
		`Starting to download ${images.length} images with concurrency ${CONCURRENCY}`,
	);

	for (let i = 0; i < images.length; i += CONCURRENCY) {
		const batch = images.slice(i, i + CONCURRENCY);

		console.log(
			`Processing batch ${Math.floor(i / CONCURRENCY) + 1}, images ${
				i + 1
			} to ${Math.min(i + CONCURRENCY, images.length)}`,
		);

		onProgress?.({
			phase: "downloading",
			current: Math.min(i + CONCURRENCY, images.length),
			total: images.length,
		});

		const results = await Promise.all(
			batch.map(async (img) => {
				try {
					const localPath = await ensureImageCached(
						img.url,
						img.path,
						imageOptions,
					);
					return { url: img.url, localPath };
				} catch (error) {
					console.error(`Error downloading image ${img.url}:`, error);
					return { url: img.url, localPath: null };
				}
			}),
		);

		for (const result of results) {
			if (result.localPath) {
				pathMap.set(result.url, result.localPath);
			}
		}
	}

	// Replace all image URLs with local file paths
	let result = markdown;
	for (const img of images) {
		const localPath = pathMap.get(img.url);
		if (localPath) {
			result = result.replace(img.fullMatch, `![${img.alt}](${localPath})`);
		} else if (imageOptions?.fallbackToLink) {
			// If download failed and fallback is enabled, tell pandoc to use the external URL directly
			// ![alt](url) -> ![alt](url){external=1}
			// This prevents pandoc from trying (and failing) to fetch the remote image during generation
			result = result.replace(
				img.fullMatch,
				`![${img.alt}](${img.url}){external=1}`,
			);
		}
	}

	return result;
}
