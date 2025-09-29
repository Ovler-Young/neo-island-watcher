import { BaseStorage } from "./base.ts";

export interface TopicBinding {
	topicId: number;
	feedUuid: string;
}

export interface GroupBindingData {
	boundFeeds: string;
	topics: {
		[threadId: string]: TopicBinding;
	};
}

export interface GroupBindingsStorage {
	[groupId: string]: GroupBindingData;
}

class GroupBindingsStorageImpl extends BaseStorage<GroupBindingsStorage> {
	constructor() {
		super("group-bindings.json");
	}

	async getGroupBinding(groupId: string): Promise<GroupBindingData | null> {
		const data = await this.read();
		return data[groupId] || null;
	}

	async bindFeedToGroup(groupId: string, feedUuid: string): Promise<void> {
		await this.update((data) => ({
			...data,
			[groupId]: {
				boundFeeds: feedUuid,
				topics: data[groupId]?.topics || {},
			},
		}));
	}

	async addTopicToGroup(
		groupId: string,
		threadId: string,
		topicId: number,
		feedUuid: string,
	): Promise<void> {
		await this.update((data) => {
			if (!data[groupId]) {
				throw new Error(`Group ${groupId} has no feed binding`);
			}

			data[groupId].topics[threadId] = { topicId, feedUuid };
			return data;
		});
	}

	async removeTopicFromGroup(groupId: string, threadId: string): Promise<void> {
		await this.update((data) => {
			if (data[groupId]) {
				delete data[groupId].topics[threadId];
			}
			return data;
		});
	}

	async unbindFeedFromGroup(groupId: string): Promise<void> {
		await this.update((data) => {
			delete data[groupId];
			return data;
		});
	}

	async getThreadIdFromGroup(
		groupId: string,
		topicId: number,
	): Promise<number | null> {
		const data = await this.read();
		const groupBinding = data[groupId];
		if (!groupBinding) {
			return null;
		}
		for (const [threadId, binding] of Object.entries(groupBinding.topics)) {
			if (binding.topicId === topicId) {
				return parseInt(threadId, 10);
			}
		}
		return null;
	}
}

export const groupBindings = new GroupBindingsStorageImpl();
