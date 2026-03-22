import { config } from "../config.ts";
import { groupCookies } from "../storage/group-cookies.ts";
import {
	getCachedPage,
	getCachedPages,
	hasCachedPage,
	setCachedPage,
} from "../utils/cache.ts";
import type {
	CDNInfo,
	FeedThread,
	ForumGroup,
	ThreadData,
	TimelineInfo,
} from "./types.ts";

export class XDNMBClient {
	private readonly apiBase: string;
	private readonly frontendBase: string;
	onCookieDisabled?: (groupId: string, error: string) => void;

	constructor() {
		this.apiBase = config.xdnmbApiBase;
		this.frontendBase = config.xdnmbFrontendBase;
	}

	private async request<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		const url = `${this.apiBase}/Api/${endpoint}`;
		const response = await fetch(url, {
			...options,
			headers: {
				"User-Agent": "Neo-Island-Watcher/1.0",
				...options.headers,
			},
		});

		if (!response.ok) {
			throw new Error(`API request failed: ${response.status}`);
		}

		console.log(`API request to ${endpoint} succeeded.`);

		const data = await response.json();

		if (
			data &&
			typeof data === "object" &&
			"success" in data &&
			data.success === false
		) {
			throw new Error(`API error: ${data.error || "Unknown error"}`);
		}

		return data;
	}

	private async requestWithCookie<T>(
		endpoint: string,
		options: RequestInit = {},
		cookie?: string,
	): Promise<T> {
		if (cookie) {
			return this.request<T>(endpoint, {
				...options,
				headers: {
					Cookie: `userhash=${cookie}`,
					...options.headers,
				},
			});
		}

		const triedGroupIds = new Set<string>();

		while (true) {
			const result = await groupCookies.getRandomCookie();
			if (!result) {
				throw new Error("No valid cookie available");
			}

			if (triedGroupIds.has(result.groupId)) {
				// All remaining cookies have been tried
				throw new Error("No valid cookie available");
			}
			triedGroupIds.add(result.groupId);

			try {
				return await this.request<T>(endpoint, {
					...options,
					headers: {
						Cookie: `userhash=${result.data.cookie}`,
						...options.headers,
					},
				});
			} catch (error) {
				if (error instanceof Error && error.message.includes("饼干")) {
					console.log(
						`🍪 Cookie from group ${result.groupId} is invalid, disabling.`,
					);
					await groupCookies.disableCookie(result.groupId);
					this.onCookieDisabled?.(result.groupId, error.message);
					continue;
				}
				throw error;
			}
		}
	}

	getCDNPaths(): Promise<CDNInfo[]> {
		return this.request<CDNInfo[]>("getCDNPath");
	}

	getForumList(): Promise<ForumGroup[]> {
		return this.request<ForumGroup[]>("getForumList");
	}

	getTimelineList(): Promise<TimelineInfo[]> {
		return this.request<TimelineInfo[]>("getTimelineList");
	}

	getFeed(uuid: string, page = 1): Promise<FeedThread[]> {
		return this.request<FeedThread[]>(`feed?uuid=${uuid}&page=${page}`);
	}

	async getThread(id: number, page = 1, maxPage?: number): Promise<ThreadData> {
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
		const data = await this.requestWithCookie<ThreadData>(
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

	getFullThread(
		id: number,
		onProgress?: (progress: {
			current: number;
			total: number;
			percentage: number;
		}) => void,
	): Promise<ThreadData> {
		return this.getUpdatedThread(id, 0, 0, onProgress);
	}

	async getUpdatedThread(
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
		const initialPageData = await this.getThread(id, startPage);
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
					this.getThread(id, pageNum, newMaxPage),
				);
				await Promise.all(chunkPromises);

				// Report backfill progress
				if (onProgress) {
					const backfilledSoFar = Math.min(
						i + concurrencyLimit,
						missingPages.length,
					);
					const totalPages = newMaxPage;
					const percentage = Math.floor(
						(backfilledSoFar / missingPages.length) * 50,
					); // First 50%
					onProgress({
						current: backfilledSoFar,
						total: totalPages,
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
				this.getThread(id, pageNum, newMaxPage),
			);
			const chunkData = await Promise.all(chunkPromises);

			allRemainingPagesData.push(...chunkData);

			// Report fetch progress
			if (onProgress) {
				const fetchedSoFar =
					Math.min(i + concurrencyLimit, pagesToFetch.length) + 1; // +1 for startPage
				const totalPages = newMaxPage;
				const percentage = Math.floor((fetchedSoFar / totalPages) * 100);
				onProgress({
					current: fetchedSoFar,
					total: totalPages,
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

	getRef(id: number): Promise<ThreadData> {
		return this.requestWithCookie<ThreadData>(`ref?id=${id}`);
	}

	getForum(id: number, page = 1): Promise<FeedThread[]> {
		return this.requestWithCookie<FeedThread[]>(`showf?id=${id}&page=${page}`);
	}

	getTimeline(id: number, page = 1): Promise<FeedThread[]> {
		return this.requestWithCookie<FeedThread[]>(
			`timeline?id=${id}&page=${page}`,
		);
	}

	async isThread(id: number): Promise<boolean> {
		const url = `${this.apiBase}/Api/thread?id=${id}`;
		const response = await fetch(url, {});

		if (!response.ok) {
			// If response is not ok, it's an API error, not necessarily "not a thread"
			// For now, we'll treat any non-200 as not a thread for this specific check
			return false;
		}

		const textResponse = await response.text();
		if (textResponse === "该串不存在") {
			return false;
		}

		// If it's not "该串不存在" and response was ok, assume it's a valid thread
		return true;
	}

	addFeed(uuid: string, threadId: string): Promise<string> {
		const url = `addFeed?uuid=${uuid}&tid=${threadId}`;
		return this.request<string>(url, { method: "POST" });
	}

	delFeed(uuid: string, threadId: string): Promise<string> {
		const url = `delFeed?uuid=${uuid}&tid=${threadId}`;
		return this.request<string>(url, { method: "POST" });
	}

	async postReply(
		threadId: string,
		content: string,
		cookie: string,
		name = "无名氏",
		title = "无标题",
	): Promise<string> {
		const url = `${this.frontendBase}/home/forum/doReplyThread.html`;
		const formData = new FormData();
		formData.append("name", name);
		formData.append("title", title);
		formData.append("content", content);
		formData.append("resto", threadId);

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"User-Agent": "Neo-Island-Watcher/1.0",
				Cookie: `userhash=${cookie}`,
			},
			body: formData,
		});

		return await response.text();
	}

	buildThreadUrl(threadId: string): string {
		return `${this.frontendBase}/t/${threadId}`;
	}

	buildRefUrl(postId: string): string {
		return `${this.frontendBase}/Home/Forum/ref/id/${postId}`;
	}
}

export const xdnmbClient = new XDNMBClient();
