import { BaseStorage } from "./base.ts";

export interface FeedStateData {
	lastCheck: string;
	knownThreads: string[];
	boundGroups: number[];
}

export interface FeedStateStorage {
	[feedUuid: string]: FeedStateData;
}

class FeedStatesStorage extends BaseStorage<FeedStateStorage> {
	constructor() {
		super("feed-state.json");
	}

	async getFeedState(feedUuid: string): Promise<FeedStateData | null> {
		const data = await this.read();
		return data[feedUuid] || null;
	}

	async updateFeedCheck(
		feedUuid: string,
		knownThreads: string[],
	): Promise<void> {
		await this.update((data) => ({
			...data,
			[feedUuid]: {
				...data[feedUuid],
				lastCheck: new Date().toISOString(),
				knownThreads,
			},
		}));
	}

	async bindGroupToFeed(feedUuid: string, groupId: number): Promise<void> {
		await this.update((data) => {
			const current = data[feedUuid] || {
				lastCheck: new Date().toISOString(),
				knownThreads: [],
				boundGroups: [],
			};

			if (!current.boundGroups.includes(groupId)) {
				current.boundGroups.push(groupId);
			}

			return {
				...data,
				[feedUuid]: current,
			};
		});
	}

	async unbindGroupFromFeed(feedUuid: string, groupId: number): Promise<void> {
		await this.update((data) => {
			if (data[feedUuid]) {
				data[feedUuid].boundGroups = data[feedUuid].boundGroups.filter(
					(id) => id !== groupId,
				);

				if (data[feedUuid].boundGroups.length === 0) {
					delete data[feedUuid];
				}
			}
			return data;
		});
	}

	async getAllActiveFeeds(): Promise<string[]> {
		const data = await this.read();
		return Object.keys(data);
	}
}

export const feedStates = new FeedStatesStorage();
