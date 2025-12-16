import { ensureDir } from "@std/fs";
import { join, resolve } from "@std/path";

/**
 * Image cache service for storing downloaded images.
 * Uses file path as cache key for easy management.
 */

const CACHE_DIR = "data/image-cache";
const DEFAULT_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

export interface ImageCacheOptions {
	timeoutMs?: number;
	retries?: number;
	retryDelayMs?: number;
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
 * Fetch and read the response body with timeout support.
 * The timeout applies to the ENTIRE operation (headers + body).
 */
async function fetchAndReadWithTimeout(
	url: string,
	timeoutMs: number,
): Promise<{ ok: boolean; status: number; data?: Uint8Array }> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, { signal: controller.signal });

		if (!response.ok) {
			return { ok: false, status: response.status };
		}

		// This await is also protected by the timeout signal
		const buffer = await response.arrayBuffer();
		return { ok: true, status: response.status, data: new Uint8Array(buffer) };
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
	options: ImageCacheOptions = {},
): Promise<string | null> {
	// Try cache first
	const cached = await getCachedImagePath(imagePath);
	if (cached) {
		return cached;
	}

	const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
	const maxRetries = options.retries ?? DEFAULT_MAX_RETRIES;
	const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

	// Fetch with retry logic
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const result = await fetchAndReadWithTimeout(imageUrl, timeoutMs);

			if (!result.ok) {
				console.error(`Failed to fetch image: ${imageUrl} - ${result.status}`);
				if (attempt < maxRetries) {
					// Only logretry if we are actually going to retry
					console.log(`Retrying in ${retryDelayMs}ms...`);
					await sleep(retryDelayMs);
					continue;
				}
				// If we are out of retries, we return null below
				break;
			}

			// We have data!
			if (result.data) {
				return await cacheImage(imagePath, result.data);
			}
		} catch (error) {
			const isTimeout =
				error instanceof DOMException && error.name === "AbortError";
			const errorType = isTimeout ? "timeout" : "error";
			console.error(
				`Fetch ${errorType} for ${imageUrl} (attempt ${attempt}/${maxRetries}):`,
				error,
			);

			if (attempt < maxRetries) {
				console.log(`Retrying in ${retryDelayMs}ms...`);
				await sleep(retryDelayMs);
			} else {
				console.error(
					`All ${maxRetries} attempts failed for ${imageUrl}, giving up`,
				);
				return null;
			}
		}
	}

	return null;
}
