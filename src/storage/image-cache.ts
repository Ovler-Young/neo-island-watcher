import { encodeBase64 } from "@std/encoding/base64";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

/**
 * Image cache service for storing downloaded images.
 * Uses file path as cache key for easy management.
 */

const CACHE_DIR = "data/image-cache";

interface CachedImageInfo {
	mimeType: string;
}

/**
 * Get the cache file path for a given image path.
 * Uses the image path directly (sanitized) as the cache key.
 */
function getCacheFilePath(imagePath: string): string {
	// Sanitize the path to create a valid filename
	// e.g., "/image/abc123.jpg" -> "image_abc123.jpg"
	const sanitized = imagePath.replace(/^\//, "").replace(/\//g, "_");
	return join(CACHE_DIR, sanitized);
}

/**
 * Get the metadata file path for a cached image.
 */
function getMetaFilePath(imagePath: string): string {
	return `${getCacheFilePath(imagePath)}.meta.json`;
}

/**
 * Check if an image is cached.
 */
export async function hasImageInCache(imagePath: string): Promise<boolean> {
	const cacheFile = getCacheFilePath(imagePath);
	try {
		await Deno.stat(cacheFile);
		return true;
	} catch {
		return false;
	}
}

/**
 * Get a cached image as base64 data URI.
 * Returns null if not cached.
 */
export async function getCachedImageAsBase64(
	imagePath: string,
): Promise<string | null> {
	const cacheFile = getCacheFilePath(imagePath);
	const metaFile = getMetaFilePath(imagePath);

	try {
		const [imageData, metaData] = await Promise.all([
			Deno.readFile(cacheFile),
			Deno.readTextFile(metaFile),
		]);

		const meta: CachedImageInfo = JSON.parse(metaData);
		const base64 = encodeBase64(imageData);
		return `data:${meta.mimeType};base64,${base64}`;
	} catch {
		return null;
	}
}

/**
 * Store an image in the cache.
 */
export async function cacheImage(
	imagePath: string,
	data: Uint8Array,
	mimeType: string,
): Promise<void> {
	await ensureDir(CACHE_DIR);

	const cacheFile = getCacheFilePath(imagePath);
	const metaFile = getMetaFilePath(imagePath);

	const meta: CachedImageInfo = { mimeType };

	await Promise.all([
		Deno.writeFile(cacheFile, data),
		Deno.writeTextFile(metaFile, JSON.stringify(meta)),
	]);
}

/**
 * Get image as base64 data URI, using cache if available.
 * Falls back to fetching if not cached.
 */
export async function getImageAsBase64(
	imageUrl: string,
	imagePath: string,
): Promise<string | null> {
	// Try cache first
	const cached = await getCachedImageAsBase64(imagePath);
	if (cached) {
		return cached;
	}

	// Fetch the image
	try {
		const response = await fetch(imageUrl);
		if (!response.ok) {
			console.error(`Failed to fetch image: ${imageUrl} - ${response.status}`);
			return null;
		}

		const contentType = response.headers.get("content-type") || "image/jpeg";
		const data = new Uint8Array(await response.arrayBuffer());

		// Cache the image
		await cacheImage(imagePath, data, contentType);

		// Return as base64 data URI
		const base64 = encodeBase64(data);
		return `data:${contentType};base64,${base64}`;
	} catch (error) {
		console.error(`Error fetching image ${imageUrl}:`, error);
		return null;
	}
}
