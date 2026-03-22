import { BaseStorage } from "./base.ts";

export interface GroupCookieData {
	userId: string;
	cookie: string;
	telegramUserId: number;
	addedAt: string;
	lastUsed?: string;
	disabled?: boolean;
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

	async getRandomCookie(): Promise<{
		groupId: string;
		data: GroupCookieData;
	} | null> {
		const data = await this.read();
		const entries = Object.entries(data).filter(
			([_, cookie]) => !cookie.disabled,
		);

		if (entries.length === 0) {
			return null;
		}

		const randomIndex = Math.floor(Math.random() * entries.length);
		const [groupId, cookieData] = entries[randomIndex];
		return { groupId, data: cookieData };
	}

	async disableCookie(groupId: string): Promise<void> {
		await this.update((data) => {
			if (data[groupId]) {
				data[groupId].disabled = true;
			}
			return data;
		});
	}

	async getAllCookies(): Promise<GroupCookieData[]> {
		const data = await this.read();
		return Object.values(data);
	}
}

export const groupCookies = new GroupCookiesStorage();
