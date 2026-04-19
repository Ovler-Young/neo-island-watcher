import { config } from "../config.ts";
import { groupCookies } from "../storage/group-cookies.ts";
import type {
	CDNInfo,
	FeedThread,
	ForumGroup,
	ThreadData,
	TimelineInfo,
} from "./types.ts";
import {
	getFullThread,
	getThreadBatch,
	getThread,
	getThreadPages,
	getUpdatedThread,
} from "./xdnmb-thread.ts";
import type { ThreadPageRequest, ThreadPageResult } from "./xdnmb-thread.ts";

const OFFICIAL_XDNMB_API_BASE = "https://api.nmb.best";

function normalizeBaseUrl(url: string): string {
	const normalized = new URL(url);
	normalized.hash = "";
	normalized.search = "";
	normalized.pathname = normalized.pathname.replace(/\/+$/, "");
	return normalized.toString().replace(/\/$/, "");
}

export class XDNMBClient {
	readonly apiBase: string;
	readonly frontendBase: string;
	readonly canUseProxyFormat: boolean;
	onCookieDisabled?: (groupId: string, error: string) => void;

	constructor() {
		this.apiBase = config.xdnmbApiBase;
		this.frontendBase = config.xdnmbFrontendBase;
		this.canUseProxyFormat =
			config.xdnmbProxyFormatEnabled &&
			normalizeBaseUrl(this.apiBase) !==
				normalizeBaseUrl(OFFICIAL_XDNMB_API_BASE);

		if (config.xdnmbProxyFormatEnabled && !this.canUseProxyFormat) {
			console.warn(
				"⚠️ XDNMB_PROXY_FORMAT_ENABLED is set, but XDNMB_API_BASE still points to the official upstream. /Api/thread/batch requests will be skipped.",
			);
		}
	}

	async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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

		// console.log(`API request to ${endpoint} succeeded.`);

		const data = await response.json();

		if (typeof data === "string") {
			throw new Error(`API error: ${data}`);
		}

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

	async requestWithCookie<T>(
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
				if (error instanceof Error && error.message.includes("维护")) {
					throw error;
				}
				if (error instanceof Error && error.message.includes("饼干")) {
					console.log(
						`🍪 Cookie from group ${result.groupId} is invalid, disabling. (${error.message})`,
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

	getThread(id: number, page = 1, maxPage?: number): Promise<ThreadData> {
		return getThread(this, id, page, maxPage);
	}

	getThreadBatch(requests: ThreadPageRequest[]): Promise<ThreadPageResult[]> {
		return getThreadBatch(this, requests);
	}

	getThreadPages(
		id: number,
		pages: number[],
		maxPage?: number,
	): Promise<ThreadData[]> {
		return getThreadPages(this, id, pages, maxPage);
	}

	getFullThread(
		id: number,
		onProgress?: (progress: {
			current: number;
			total: number;
			percentage: number;
		}) => void,
	): Promise<ThreadData> {
		return getFullThread(this, id, onProgress);
	}

	getUpdatedThread(
		id: number,
		lastCount = 0,
		lastReplyId = 0,
		onProgress?: (progress: {
			current: number;
			total: number;
			percentage: number;
		}) => void,
	): Promise<ThreadData> {
		return getUpdatedThread(this, id, lastCount, lastReplyId, onProgress);
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
