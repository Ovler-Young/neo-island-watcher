import { BaseStorage } from "./base.ts";

export interface GroupCookieData {
	userId: string;
	cookie: string;
	telegramUserId: number;
	addedAt: string;
	lastUsed?: string;
}

export interface GroupCookieStorage {
	[groupId: string]: GroupCookieData;
}

class GroupCookiesStorage extends BaseStorage<GroupCookieStorage> {
	constructor() {
		super("group-cookies.json");
	}

	async setCookie(
		groupId: string,
		userId: string,
		cookie: string,
		telegramUserId: number,
	): Promise<void> {
		await this.update((data) => ({
			...data,
			[groupId]: {
				userId,
				cookie,
				telegramUserId,
				addedAt: new Date().toISOString(),
				lastUsed: new Date().toISOString(),
			},
		}));
	}

	async getCookie(groupId: string): Promise<GroupCookieData | null> {
		const data = await this.read();
		return data[groupId] || null;
	}

	async updateLastUsed(groupId: string): Promise<void> {
		await this.update((data) => {
			if (data[groupId]) {
				data[groupId].lastUsed = new Date().toISOString();
			}
			return data;
		});
	}

	async removeCookie(groupId: string): Promise<void> {
		await this.update((data) => {
			const newData = { ...data };
			delete newData[groupId];
			return newData;
		});
	}

	async getRandomCookie(): Promise<GroupCookieData | null> {
		const data = await this.read();
		const cookies = Object.values(data);

		if (cookies.length === 0) {
			return null;
		}

		// Randomly select a cookie from available cookies
		const randomIndex = Math.floor(Math.random() * cookies.length);
		return cookies[randomIndex];
	}

	async getAllCookies(): Promise<GroupCookieData[]> {
		const data = await this.read();
		return Object.values(data);
	}
}

export const groupCookies = new GroupCookiesStorage();
