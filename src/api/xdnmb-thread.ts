import {
	getCachedPage,
	getCachedPages,
	hasCachedPage,
	setCachedPage,
} from "../utils/cache.ts";
import type { ThreadData } from "./types.ts";
import type { XDNMBClient } from "./xdnmb.ts";

const REPLIES_PER_PAGE = 19;
const DEFAULT_PAGE_CONCURRENCY = 3;
const MAX_PROXY_BATCH_SIZE = 100;

export interface ThreadPageRequest {
	id: number;
	page: number;
	maxPage?: number;
}

export interface ThreadPageResult {
	id: number;
	page: number;
	data?: ThreadData;
	error?: string;
}

function buildThreadPageKey(id: number, page: number): string {
	return `${id}:${page}`;
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += chunkSize) {
		chunks.push(items.slice(i, i + chunkSize));
	}
	return chunks;
}

function getThreadPageError(value: unknown): string | null {
	if (typeof value === "string") {
		return value;
	}

	if (
		value &&
		typeof value === "object" &&
		"success" in value &&
		value.success === false
	) {
		return "error" in value && typeof value.error === "string"
			? value.error
			: "Unknown error";
	}

	return null;
}

function isThreadData(value: unknown): value is ThreadData {
	return (
		!!value &&
		typeof value === "object" &&
		"Replies" in value &&
		Array.isArray(value.Replies)
	);
}

async function cacheThreadPage(
	id: number,
	page: number,
	data: ThreadData,
	maxPage?: number,
): Promise<void> {
	const threadId = id.toString();
	const calculatedMaxPage =
		maxPage ?? Math.ceil(data.ReplyCount / REPLIES_PER_PAGE);

	if (page < calculatedMaxPage) {
		await setCachedPage(threadId, page, data);
	}
}

async function fetchThreadPageIndividually(
	client: XDNMBClient,
	requests: ThreadPageRequest[],
): Promise<ThreadPageResult[]> {
	return await Promise.all(
		requests.map(async ({ id, page, maxPage }) => {
			try {
				const data = await getThread(client, id, page, maxPage);
				return { id, page, data };
			} catch (error) {
				return {
					id,
					page,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}),
	);
}

async function fetchThreadPageBatch(
	client: XDNMBClient,
	requests: ThreadPageRequest[],
): Promise<ThreadPageResult[]> {
	if (requests.length === 0) {
		return [];
	}

	if (!client.canUseProxyFormat || requests.length === 1) {
		return await fetchThreadPageIndividually(client, requests);
	}

	const batchSpec = `[${requests.map(({ id, page }) => `${id}:${page}`).join(",")}]`;
	let response: Record<string, unknown>;

	try {
		response = await client.requestWithCookie<Record<string, unknown>>(
			`thread/batch/${batchSpec}`,
		);
	} catch {
		return await fetchThreadPageIndividually(client, requests);
	}

	const successfulResults = new Map<string, ThreadPageResult>();
	const fallbackRequests: ThreadPageRequest[] = [];

	for (const request of requests) {
		const key = buildThreadPageKey(request.id, request.page);

		if (!Object.prototype.hasOwnProperty.call(response, key)) {
			fallbackRequests.push(request);
			continue;
		}

		const value = response[key];
		const error = getThreadPageError(value);

		if (error || !isThreadData(value)) {
			fallbackRequests.push(request);
			continue;
		}

		await cacheThreadPage(request.id, request.page, value, request.maxPage);
		successfulResults.set(key, {
			id: request.id,
			page: request.page,
			data: value,
		});
	}

	if (fallbackRequests.length === 0) {
		return requests.map((request) => {
			const result = successfulResults.get(
				buildThreadPageKey(request.id, request.page),
			);
			if (!result) {
				return {
					id: request.id,
					page: request.page,
					error: `Missing batch entry ${buildThreadPageKey(request.id, request.page)}`,
				};
			}
			return result;
		});
	}

	const fallbackResults = await fetchThreadPageIndividually(
		client,
		fallbackRequests,
	);
	const resultMap = new Map<string, ThreadPageResult>();

	for (const result of successfulResults.values()) {
		resultMap.set(buildThreadPageKey(result.id, result.page), result);
	}

	for (const result of fallbackResults) {
		resultMap.set(buildThreadPageKey(result.id, result.page), result);
	}

	return requests.map((request) => {
		const result = resultMap.get(buildThreadPageKey(request.id, request.page));
		if (!result) {
			return {
				id: request.id,
				page: request.page,
				error: `Missing batch entry ${buildThreadPageKey(request.id, request.page)}`,
			};
		}
		return result;
	});
}

export async function getThread(
	client: XDNMBClient,
	id: number,
	page = 1,
	maxPage?: number,
): Promise<ThreadData> {
	const threadId = id.toString();

	// Check cache first
	const cachedData = await getCachedPage(threadId, page);
	if (cachedData && maxPage && page < maxPage) {
		return cachedData;
	}

	// Fetch from API
	const data = await client.requestWithCookie<ThreadData>(
		`thread?id=${id}&page=${page}`,
	);

	await cacheThreadPage(id, page, data, maxPage);
	return data;
}

export async function getThreadBatch(
	client: XDNMBClient,
	requests: ThreadPageRequest[],
): Promise<ThreadPageResult[]> {
	const uniqueRequests = [
		...new Map(
			requests
				.filter((request) => request.page > 0)
				.map((request) => [buildThreadPageKey(request.id, request.page), request]),
		).values(),
	];

	if (uniqueRequests.length === 0) {
		return [];
	}

	const chunkSize = client.canUseProxyFormat
		? MAX_PROXY_BATCH_SIZE
		: DEFAULT_PAGE_CONCURRENCY;
	const results: ThreadPageResult[] = [];

	for (const requestChunk of chunkItems(uniqueRequests, chunkSize)) {
		results.push(...(await fetchThreadPageBatch(client, requestChunk)));
	}

	return results;
}

export async function getThreadPages(
	client: XDNMBClient,
	id: number,
	pages: number[],
	maxPage?: number,
): Promise<ThreadData[]> {
	const normalizedPages = [...new Set(pages)]
		.filter((page) => page > 0)
		.sort((a, b) => a - b);

	if (normalizedPages.length === 0) {
		return [];
	}

	const results = await getThreadBatch(
		client,
		normalizedPages.map((page) => ({ id, page, maxPage })),
	);
	const pageDataMap = new Map<number, ThreadData>();

	for (const result of results) {
		if (result.error) {
			throw new Error(`Thread ${id} page ${result.page} failed: ${result.error}`);
		}

		if (!result.data) {
			throw new Error(`Missing thread page ${result.page} for thread ${id}`);
		}

		pageDataMap.set(result.page, result.data);
	}

	return normalizedPages.map((page) => {
		const pageData = pageDataMap.get(page);
		if (!pageData) {
			throw new Error(`Missing thread page ${page} for thread ${id}`);
		}
		return pageData;
	});
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
	const startPage = Math.max(1, Math.ceil(lastCount / REPLIES_PER_PAGE));

	// Get initial page to determine total reply count
	const initialPageData = await getThread(client, id, startPage);
	const newTotalReplyCount = initialPageData.ReplyCount;

	if (newTotalReplyCount <= lastCount) {
		initialPageData.Replies = [];
		return initialPageData;
	}

	const newMaxPage = Math.ceil(newTotalReplyCount / REPLIES_PER_PAGE);

	// Check for missing cached pages and backfill them
	const cachedPages = await getCachedPages(threadId);
	const missingPages: number[] = [];

	// Find missing pages from 1 to newMaxPage-1 (excluding last page)
	for (let i = 1; i < newMaxPage; i++) {
		if (!cachedPages.includes(i) && !(await hasCachedPage(threadId, i))) {
			missingPages.push(i);
		}
	}

	const progressChunkSize = client.canUseProxyFormat
		? MAX_PROXY_BATCH_SIZE
		: DEFAULT_PAGE_CONCURRENCY;

	// Backfill missing pages
	if (missingPages.length > 0) {
		console.log(
			`🔄 Backfilling ${missingPages.length} missing pages for thread ${threadId}`,
		);
		let backfilledSoFar = 0;

		for (const pageChunk of chunkItems(missingPages, progressChunkSize)) {
			await getThreadPages(client, id, pageChunk, newMaxPage);
			backfilledSoFar += pageChunk.length;

			// Report backfill progress
			if (onProgress) {
				const percentage = Math.floor(
					(backfilledSoFar / missingPages.length) * 50,
				);
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
	let fetchedSoFar = 1;

	for (const pageChunk of chunkItems(pagesToFetch, progressChunkSize)) {
		const chunkData = await getThreadPages(client, id, pageChunk, newMaxPage);
		allRemainingPagesData.push(...chunkData);
		fetchedSoFar += pageChunk.length;

		// Report fetch progress
		if (onProgress) {
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
