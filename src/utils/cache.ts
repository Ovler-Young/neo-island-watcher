import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import type { ThreadData } from "../api/types.ts";

const CACHE_BASE_DIR = "./cache";

/**
 * Ensure cache directory exists for a specific thread
 */
export async function ensureCacheDir(threadId: string): Promise<string> {
	const threadCacheDir = join(CACHE_BASE_DIR, threadId);
	await ensureDir(threadCacheDir);
	return threadCacheDir;
}

/**
 * Get the cache file path for a specific thread and page
 */
function getCacheFilePath(threadId: string, page: number): string {
	return join(CACHE_BASE_DIR, threadId, `page${page}.json`);
}

/**
 * Check if a cached page exists
 */
export async function hasCachedPage(
	threadId: string,
	page: number,
): Promise<boolean> {
	const filePath = getCacheFilePath(threadId, page);
	return await exists(filePath);
}

/**
 * Get cached page data
 */
export async function getCachedPage(
	threadId: string,
	page: number,
): Promise<ThreadData | null> {
	try {
		const filePath = getCacheFilePath(threadId, page);
		if (!(await exists(filePath))) {
			return null;
		}

		const content = await Deno.readTextFile(filePath);
		const data = JSON.parse(content) as ThreadData;
		return data;
	} catch (error) {
		console.error(
			`Error reading cache for thread ${threadId}, page ${page}:`,
			error,
		);
		return null;
	}
}

/**
 * Set cached page data
 */
export async function setCachedPage(
	threadId: string,
	page: number,
	data: ThreadData,
): Promise<void> {
	try {
		await ensureCacheDir(threadId);
		const filePath = getCacheFilePath(threadId, page);
		await Deno.writeTextFile(filePath, JSON.stringify(data, null, 2));
		console.log(`💾 Cached: thread ${threadId}, page ${page}`);
	} catch (error) {
		console.error(
			`Error writing cache for thread ${threadId}, page ${page}:`,
			error,
		);
	}
}

/**
 * Get the maximum cached page number for a thread
 */
export async function getMaxCachedPage(threadId: string): Promise<number> {
	try {
		const threadCacheDir = join(CACHE_BASE_DIR, threadId);
		if (!(await exists(threadCacheDir))) {
			return 0;
		}

		let maxPage = 0;
		for await (const entry of Deno.readDir(threadCacheDir)) {
			if (entry.isFile && entry.name.match(/^page(\d+)\.json$/)) {
				const pageNum = Number.parseInt(
					entry.name.replace("page", "").replace(".json", ""),
					10,
				);
				if (pageNum > maxPage) {
					maxPage = pageNum;
				}
			}
		}
		return maxPage;
	} catch (error) {
		console.error(
			`Error getting max cached page for thread ${threadId}:`,
			error,
		);
		return 0;
	}
}

/**
 * Get all cached pages for a thread
 */
export async function getCachedPages(threadId: string): Promise<number[]> {
	try {
		const threadCacheDir = join(CACHE_BASE_DIR, threadId);
		if (!(await exists(threadCacheDir))) {
			return [];
		}

		const pages: number[] = [];
		for await (const entry of Deno.readDir(threadCacheDir)) {
			if (entry.isFile && entry.name.match(/^page(\d+)\.json$/)) {
				const pageNum = Number.parseInt(
					entry.name.replace("page", "").replace(".json", ""),
					10,
				);
				pages.push(pageNum);
			}
		}
		return pages.sort((a, b) => a - b);
	} catch (error) {
		console.error(`Error getting cached pages for thread ${threadId}:`, error);
		return [];
	}
}
