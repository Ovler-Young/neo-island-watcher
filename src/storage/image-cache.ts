import { ensureDir } from "@std/fs";
import { join, resolve } from "@std/path";

/**
 * Image cache service for storing downloaded images.
 * Uses file path as cache key for easy management.
 */

const CACHE_DIR = "data/image-cache";

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
 * Get the absolute path to a cached image file.
 * Returns null if not cached.
 */
export async function getCachedImagePath(
	imagePath: string,
): Promise<string | null> {
	const cacheFile = getCacheFilePath(imagePath);
	try {
		await Deno.stat(cacheFile);
		return resolve(cacheFile);
	} catch {
		return null;
	}
}

/**
 * Store an image in the cache.
 * Returns the absolute path to the cached file.
 */
export async function cacheImage(
	imagePath: string,
	data: Uint8Array,
): Promise<string> {
	await ensureDir(CACHE_DIR);

	const cacheFile = getCacheFilePath(imagePath);
	await Deno.writeFile(cacheFile, data);

	return resolve(cacheFile);
}

/**
 * Ensure an image is cached and return its local file path.
 * Downloads the image if not already cached.
 */
export async function ensureImageCached(
	imageUrl: string,
	imagePath: string,
): Promise<string | null> {
	// Try cache first
	const cached = await getCachedImagePath(imagePath);
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

		const data = new Uint8Array(await response.arrayBuffer());

		// Cache the image and return path
		return await cacheImage(imagePath, data);
	} catch (error) {
		console.error(`Error fetching image ${imageUrl}:`, error);
		return null;
	}
}
