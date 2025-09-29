import { BaseStorage } from "./base.ts";

export interface ThreadBinding {
	groupId: number;
	topicId: number;
	feedUuid?: string;
}

export interface ThreadStateData {
	title: string;
	lastReplyCount: number;
	lastReplyId: number;
	lastCheck: string;
	writer: string[];
	bindings: ThreadBinding[];
}

export interface ThreadStateStorage {
	[threadId: string]: ThreadStateData;
}

class ThreadStatesStorage extends BaseStorage<ThreadStateStorage> {
	constructor() {
		super("thread-state.json");
	}

	async getThreadState(threadId: string): Promise<ThreadStateData | null> {
		const data = await this.read();
		return data[threadId] || null;
	}

	async getAllThreads(): Promise<ThreadStateStorage> {
		return await this.read();
	}

	async createThreadState(
		threadId: string,
		threadData: ThreadStateData,
	): Promise<void> {
		await this.update((data) => ({
			...data,
			[threadId]: threadData,
		}));
	}

	async updateThreadState(
		threadId: string,
		updates: Partial<ThreadStateData>,
	): Promise<void> {
		await this.update((data) => ({
			...data,
			[threadId]: {
				...data[threadId],
				...updates,
				lastCheck: new Date().toISOString(),
			},
		}));
	}

	async addBinding(threadId: string, binding: ThreadBinding): Promise<void> {
		await this.update((data) => {
			if (!data[threadId]) {
				throw new Error(`Thread ${threadId} not found`);
			}

			const existing = data[threadId].bindings.find(
				(b) => b.groupId === binding.groupId,
			);
			if (!existing) {
				data[threadId].bindings.push(binding);
			}

			return data;
		});
	}

	async removeBinding(threadId: string, groupId: number): Promise<void> {
		await this.update((data) => {
			if (data[threadId]) {
				data[threadId].bindings = data[threadId].bindings.filter(
					(b) => b.groupId !== groupId,
				);

				if (data[threadId].bindings.length === 0) {
					delete data[threadId];
				}
			}
			return data;
		});
	}
}

export const threadStates = new ThreadStatesStorage();
