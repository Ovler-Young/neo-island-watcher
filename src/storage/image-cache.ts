import { ensureDir } from "@std/fs";
import { join, resolve } from "@std/path";

/**
 * Image cache service for storing downloaded images.
 * Uses file path as cache key for easy management.
 */

const CACHE_DIR = "data/image-cache";
const FETCH_TIMEOUT_MS = 10000; // 10 seconds timeout
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000; // 2 seconds between retries

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
 * Fetch with timeout support.
 */
async function fetchWithTimeout(
	url: string,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, { signal: controller.signal });
		return response;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure an image is cached and return its local file path.
 * Downloads the image if not already cached.
 * Includes timeout and retry logic for unstable servers.
 */
export async function ensureImageCached(
	imageUrl: string,
	imagePath: string,
): Promise<string | null> {
	console.log(`ensureImageCached called for ${imagePath}`);

	// Try cache first
	const cached = await getCachedImagePath(imagePath);
	if (cached) {
		console.log(`Image ${imagePath} found in cache: ${cached}`);
		return cached;
	}

	console.log(`Image ${imagePath} not in cache, fetching from ${imageUrl}`);

	// Fetch with retry logic
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			console.log(
				`Starting fetch for ${imageUrl} (attempt ${attempt}/${MAX_RETRIES})`,
			);
			const response = await fetchWithTimeout(imageUrl, FETCH_TIMEOUT_MS);
			console.log(
				`Fetch completed for ${imageUrl}, status: ${response.status}`,
			);

			if (!response.ok) {
				console.error(
					`Failed to fetch image: ${imageUrl} - ${response.status}`,
				);
				if (attempt < MAX_RETRIES) {
					console.log(`Retrying in ${RETRY_DELAY_MS}ms...`);
					await sleep(RETRY_DELAY_MS);
					continue;
				}
				return null;
			}

			console.log(`Reading response body for ${imageUrl}`);
			const data = new Uint8Array(await response.arrayBuffer());
			console.log(`Got ${data.length} bytes for ${imageUrl}`);

			// Cache the image and return path
			console.log(`Caching image ${imagePath}`);
			const result = await cacheImage(imagePath, data);
			console.log(`Cached image ${imagePath} to ${result}`);
			return result;
		} catch (error) {
			const isTimeout =
				error instanceof DOMException && error.name === "AbortError";
			const errorType = isTimeout ? "timeout" : "error";
			console.error(
				`Fetch ${errorType} for ${imageUrl} (attempt ${attempt}/${MAX_RETRIES}):`,
				error,
			);

			if (attempt < MAX_RETRIES) {
				console.log(`Retrying in ${RETRY_DELAY_MS}ms...`);
				await sleep(RETRY_DELAY_MS);
			} else {
				console.error(
					`All ${MAX_RETRIES} attempts failed for ${imageUrl}, giving up`,
				);
				return null;
			}
		}
	}

	return null;
}
