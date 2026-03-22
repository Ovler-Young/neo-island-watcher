import {
	getCachedPage,
	getCachedPages,
	hasCachedPage,
	setCachedPage,
} from "../utils/cache.ts";
import type { ThreadData } from "./types.ts";
import type { XDNMBClient } from "./xdnmb.ts";

export async function getThread(
	client: XDNMBClient,
	id: number,
	page = 1,
	maxPage?: number,
): Promise<ThreadData> {
	const threadId = id.toString();

	// Check cache first
	const cachedData = await getCachedPage(threadId, page);
	if (cachedData) {
		// If we have maxPage info and this is not the last page, use cache
		if (maxPage && page < maxPage) {
			return cachedData;
		}
		// If we don't have maxPage info but cache exists, use it for now
		// (will be updated if it turns out to be the last page)
		if (!maxPage) {
			return cachedData;
		}
	}

	// Fetch from API
	const data = await client.requestWithCookie<ThreadData>(
		`thread?id=${id}&page=${page}`,
	);

	// Calculate if this is the last page
	const calculatedMaxPage = Math.ceil(data.ReplyCount / 19);
	const isLastPage = page >= calculatedMaxPage;

	// Only cache non-last pages
	if (!isLastPage) {
		await setCachedPage(threadId, page, data);
	}

	return data;
}

export function getFullThread(
	client: XDNMBClient,
	id: number,
	onProgress?: (progress: {
		current: number;
		total: number;
		percentage: number;
	}) => void,
): Promise<ThreadData> {
	return getUpdatedThread(client, id, 0, 0, onProgress);
}

export async function getUpdatedThread(
	client: XDNMBClient,
	id: number,
	lastCount = 0,
	lastReplyId = 0,
	onProgress?: (progress: {
		current: number;
		total: number;
		percentage: number;
	}) => void,
): Promise<ThreadData> {
	const threadId = id.toString();
	const startPage = Math.max(1, Math.ceil(lastCount / 19));

	// Get initial page to determine total reply count
	const initialPageData = await getThread(client, id, startPage);
	const newTotalReplyCount = initialPageData.ReplyCount;

	if (newTotalReplyCount <= lastCount) {
		initialPageData.Replies = [];
		return initialPageData;
	}

	const newMaxPage = Math.ceil(newTotalReplyCount / 19);

	// Check for missing cached pages and backfill them
	const cachedPages = await getCachedPages(threadId);
	const missingPages: number[] = [];

	// Find missing pages from 1 to newMaxPage-1 (excluding last page)
	for (let i = 1; i < newMaxPage; i++) {
		if (!cachedPages.includes(i) && !(await hasCachedPage(threadId, i))) {
			missingPages.push(i);
		}
	}

	// Backfill missing pages
	if (missingPages.length > 0) {
		console.log(
			`🔄 Backfilling ${missingPages.length} missing pages for thread ${threadId}`,
		);
		const concurrencyLimit = 3;
		for (let i = 0; i < missingPages.length; i += concurrencyLimit) {
			const pageChunk = missingPages.slice(i, i + concurrencyLimit);
			const chunkPromises = pageChunk.map((pageNum) =>
				getThread(client, id, pageNum, newMaxPage),
			);
			await Promise.all(chunkPromises);

			// Report backfill progress
			if (onProgress) {
				const backfilledSoFar = Math.min(
					i + concurrencyLimit,
					missingPages.length,
				);
				const percentage = Math.floor(
					(backfilledSoFar / missingPages.length) * 50,
				); // First 50%
				onProgress({
					current: backfilledSoFar,
					total: newMaxPage,
					percentage,
				});
			}
		}
	}

	// Fetch pages that need updating (from startPage to newMaxPage)
	const pagesToFetch: number[] = [];
	for (let i = startPage + 1; i <= newMaxPage; i++) {
		pagesToFetch.push(i);
	}

	const allRemainingPagesData: ThreadData[] = [];
	const concurrencyLimit = 3;

	for (let i = 0; i < pagesToFetch.length; i += concurrencyLimit) {
		const pageChunk = pagesToFetch.slice(i, i + concurrencyLimit);

		const chunkPromises = pageChunk.map((pageNum) =>
			getThread(client, id, pageNum, newMaxPage),
		);
		const chunkData = await Promise.all(chunkPromises);

		allRemainingPagesData.push(...chunkData);

		// Report fetch progress
		if (onProgress) {
			const fetchedSoFar =
				Math.min(i + concurrencyLimit, pagesToFetch.length) + 1; // +1 for startPage
			const percentage = Math.floor((fetchedSoFar / newMaxPage) * 100);
			onProgress({
				current: fetchedSoFar,
				total: newMaxPage,
				percentage,
			});
		}
	}

	const allFetchedReplies = [
		...initialPageData.Replies,
		...allRemainingPagesData.flatMap((page) => page.Replies),
	];

	const newReplies = allFetchedReplies.filter(
		(reply) => reply.id > lastReplyId,
	);

	initialPageData.Replies = newReplies;
	return initialPageData;
}
