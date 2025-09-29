import { config } from "../config.ts";
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

		return await response.json();
	}

	private async requestWithCookie<T>(
		endpoint: string,
		cookie: string,
		options: RequestInit = {},
	): Promise<T> {
		return this.request<T>(endpoint, {
			...options,
			headers: {
				Cookie: `userhash=${cookie}`,
				...options.headers,
			},
		});
	}

	async getCDNPaths(): Promise<CDNInfo[]> {
		return this.request<CDNInfo[]>("getCDNPath");
	}

	async getForumList(): Promise<ForumGroup[]> {
		return this.request<ForumGroup[]>("getForumList");
	}

	async getTimelineList(): Promise<TimelineInfo[]> {
		return this.request<TimelineInfo[]>("getTimelineList");
	}

	async getFeed(uuid: string, page = 1): Promise<FeedThread[]> {
		return this.request<FeedThread[]>(`feed?uuid=${uuid}&page=${page}`);
	}

	async getThread(id: number, page = 1): Promise<ThreadData> {
		return this.request<ThreadData>(`thread?id=${id}&page=${page}`);
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

	async getThreadWithCookie(
		id: number,
		cookie: string,
		page = 1,
	): Promise<ThreadData> {
		return this.requestWithCookie<ThreadData>(
			`thread?id=${id}&page=${page}`,
			cookie,
		);
	}

	async addFeed(uuid: string, threadId: string): Promise<string> {
		const url = `addFeed?uuid=${uuid}&tid=${threadId}`;
		return this.request<string>(url, { method: "POST" });
	}

	async delFeed(uuid: string, threadId: string): Promise<string> {
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
