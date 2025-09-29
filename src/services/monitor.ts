import type { FeedThread, Reply, ThreadData } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { bot } from "../bot/bot.ts";
import { config } from "../config.ts";
import { feedStates } from "../storage/feed-state.ts";
import { groupBindings } from "../storage/group-bindings.ts";
import { type ThreadStateData, threadStates } from "../storage/thread-state.ts";
import { formatThreadTitle } from "../utils/title.ts";
import { formatReplyMessage, formatThreadMessage } from "./formatter.ts";

let monitoringInterval: number | undefined;

export async function startMonitoring(): Promise<void> {
	console.log("📡 Starting feed monitoring...");

	if (monitoringInterval) {
		clearInterval(monitoringInterval);
	}

	await checkAllFeeds();

	monitoringInterval = setInterval(async () => {
		try {
			await checkAllFeeds();
		} catch (error) {
			console.error("Error during monitoring cycle:", error);
		}
	}, config.monitoringInterval);

	console.log(
		`✅ Monitoring started with ${config.monitoringInterval}ms interval`,
	);
}

export function stopMonitoring(): void {
	if (monitoringInterval) {
		clearInterval(monitoringInterval);
		monitoringInterval = undefined;
		console.log("🛑 Monitoring stopped");
	}
}

async function checkAllFeeds(): Promise<void> {
	try {
		const activeFeeds = await feedStates.getAllActiveFeeds();

		if (activeFeeds.length === 0) {
			console.log("📪 No active feeds to monitor");
			return;
		}

		console.log(`🔍 Checking ${activeFeeds.length} active feeds...`);

		for (const feedUuid of activeFeeds) {
			try {
				await checkFeed(feedUuid);
				await new Promise((resolve) => setTimeout(resolve, 1000));
			} catch (error) {
				console.error(`Error checking feed ${feedUuid}:`, error);
			}
		}

		// Also check existing threads for new replies
		await checkExistingThreads();
	} catch (error) {
		console.error("Error in checkAllFeeds:", error);
	}
}

async function checkFeed(feedUuid: string): Promise<void> {
	try {
		const feedData = await xdnmbClient.getFeed(feedUuid);
		const currentThreadIds = feedData.map((thread) => thread.id);

		const state = await feedStates.getFeedState(feedUuid);
		const knownThreads = state?.knownThreads || [];

		const newThreads = currentThreadIds.filter(
			(id) => !knownThreads.includes(id),
		);

		if (newThreads.length > 0) {
			console.log(
				`📄 Found ${newThreads.length} new threads in feed ${feedUuid}`,
			);

			for (const threadId of newThreads) {
				const thread = feedData.find((t) => t.id === threadId);
				if (thread) {
					await handleNewThread(thread, feedUuid);
				}
			}
		}

		await feedStates.updateFeedCheck(feedUuid, currentThreadIds);
	} catch (error) {
		console.error(`Error checking feed ${feedUuid}:`, error);
	}
}

async function handleNewThread(
	thread: FeedThread,
	feedUuid: string,
): Promise<void> {
	console.log(`🆕 New thread detected: ${thread.id} - ${thread.title}`);

	const state = await feedStates.getFeedState(feedUuid);
	if (!state) {
		return;
	}

	for (const groupId of state.boundGroups) {
		try {
			// Create topic for the thread
			const topicTitle = formatThreadTitle(
				thread.title,
				thread.id,
				thread.content,
				thread.name,
			);

			// Create forum topic
			const forumTopic = await bot.api.createForumTopic(groupId, topicTitle);
			const topicId = forumTopic.message_thread_id;

			console.log(
				`📝 Created topic ${topicId} for thread ${thread.id} in group ${groupId}`,
			);

			// Update storage with topic binding
			await groupBindings.addTopicToGroup(
				groupId.toString(),
				thread.id,
				topicId,
				feedUuid,
			);

			await threadStates.createThreadState(thread.id, {
				title: topicTitle,
				lastReplyCount: 0,
				lastReplyId: 0,
				lastCheck: new Date().toISOString(),
				writer: [thread.user_hash],
				bindings: [
					{
						groupId,
						topicId,
						feedUuid,
					},
				],
			});

			// Sleep to avoid rate limits (as per docs)
			await new Promise((resolve) => setTimeout(resolve, 4000));

			// Send initial thread message to the topic
			const initialMessage = await formatThreadMessage(
				thread.id,
				thread.user_hash,
				thread.title,
				thread.now,
				thread.content,
			);

			const sentMessage = await bot.api.sendMessage(groupId, initialMessage, {
				message_thread_id: topicId,
				parse_mode: "HTML",
			});

			// Pin the initial message
			await bot.api.pinChatMessage(groupId, sentMessage.message_id);
		} catch (error) {
			console.error(
				`Error creating topic for thread ${thread.id} in group ${groupId}:`,
				error,
			);
		}
	}
}

async function checkExistingThreads(): Promise<void> {
	try {
		const allThreads = await threadStates.getAllThreads();

		for (const threadId of Object.keys(allThreads)) {
			try {
				await checkThreadForReplies(threadId);
				await new Promise((resolve) => setTimeout(resolve, 500));
			} catch (error) {
				console.error(`Error checking thread ${threadId}:`, error);
			}
		}
	} catch (error) {
		console.error("Error in checkExistingThreads:", error);
	}
}

async function checkThreadForReplies(threadId: string): Promise<void> {
	try {
		const threadState = await threadStates.getThreadState(threadId);
		if (!threadState) {
			return;
		}

		const threadData: ThreadData = await xdnmbClient.getUpdatedThread(
			Number(threadId),
			threadState.lastReplyCount,
			threadState.lastReplyId,
		);

		const currentReplyCount = threadData.ReplyCount;


		if (threadData.Replies.length === 0) {
			return;
		}

		console.log(
			`📬 Thread ${threadId} has  ${threadData.Replies.length} new replies: ${threadState.lastReplyCount} -> ${currentReplyCount}`,
		);

		const newReplies = threadData.Replies;

		for (const reply of newReplies) {
			await handleNewReply(reply, threadId, threadState);
		}

		await threadStates.updateThreadState(threadId, {
			lastReplyCount: currentReplyCount,
			lastReplyId: threadData.Replies[threadData.Replies.length - 1]?.id || 0,
		});
	} catch (error) {
		console.error(`Error checking thread ${threadId} for replies:`, error);
	}
}

async function handleNewReply(
	reply: Reply,
	threadId: string,
	threadState: ThreadStateData,
): Promise<void> {
	if (!threadState.writer.includes(reply.user_hash)) {
		return;
	}
	try {
		for (const binding of threadState.bindings) {
			const replyMessage = await formatReplyMessage(
				reply,
				threadId
			);

			await bot.api.sendMessage(binding.groupId, replyMessage, {
				message_thread_id: binding.topicId,
				parse_mode: "HTML",
			});
		}
	} catch (error) {
		console.error(`Error sending reply ${reply.id}:`, error);
	}
}
