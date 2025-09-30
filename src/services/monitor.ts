import type { FeedThread, Reply } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { bot } from "../bot/bot.ts";
import { config } from "../config.ts";
import { feedStates } from "../storage/feed-state.ts";
import { groupBindings } from "../storage/group-bindings.ts";
import { type ThreadStateData, threadStates } from "../storage/thread-state.ts";
import { isSpamContent } from "../utils/filter.ts";
import { formatTitle } from "../utils/title.ts";
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
		let pageno = 1;
		let ThreadIds: string[] = [];
		while (true) {
			const feedData = await xdnmbClient.getFeed(feedUuid, pageno);
			if (feedData.length === 0) {
				break;
			}
			const currentThreadIds = feedData.map((thread) => thread.id);
			ThreadIds = ThreadIds.concat(currentThreadIds);
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
			pageno++;
		}

		await feedStates.updateFeedCheck(feedUuid, ThreadIds);
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
			const topicTitle = formatTitle(thread);

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
			const initialMessage = await formatThreadMessage(thread);

			const sentMessage = await bot.api.sendMessage(groupId, initialMessage, {
				message_thread_id: topicId,
				parse_mode: "HTML",
				link_preview_options: {
					is_disabled: !thread.img && !thread.ext,
				},
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

		const newRepliesByPage = await fetchNewReplies(threadId, threadState);
		if (newRepliesByPage.length === 0) {
			return;
		}

		await processAndSendReplies(threadId, threadState, newRepliesByPage);
	} catch (error) {
		console.error(`Error checking thread ${threadId} for replies:`, error);
	}
}

async function fetchNewReplies(
	threadId: string,
	threadState: ThreadStateData,
): Promise<Array<{ page: number; replies: Reply[] }>> {
	const lastCount = threadState.lastReplyCount || 0;
	const startPage = Math.max(1, Math.ceil(lastCount / 19));

	const firstPageData = await xdnmbClient.getThread(
		Number(threadId),
		startPage,
	);
	const newTotalReplyCount = firstPageData.ReplyCount;

	if (newTotalReplyCount <= lastCount) {
		return [];
	}

	console.log(
		`📬 Thread ${threadId}: ${lastCount} -> ${newTotalReplyCount} replies`,
	);

	const maxPage = Math.ceil(newTotalReplyCount / 19);
	const newRepliesByPage: Array<{ page: number; replies: Reply[] }> = [];

	for (let page = startPage; page <= maxPage; page++) {
		const pageData =
			page === startPage
				? firstPageData
				: await xdnmbClient.getThread(Number(threadId), page);

		const newReplies = pageData.Replies.filter(
			(reply) => reply.id > threadState.lastReplyId,
		);

		if (newReplies.length > 0) {
			newRepliesByPage.push({ page, replies: newReplies });
		}
	}

	return newRepliesByPage;
}

async function processAndSendReplies(
	threadId: string,
	threadState: ThreadStateData,
	repliesByPage: Array<{ page: number; replies: Reply[] }>,
): Promise<void> {
	for (const { page, replies } of repliesByPage) {
		const filteredReplies = replies.filter((reply) =>
			shouldSendReply(reply, threadState),
		);

		if (filteredReplies.length > 0) {
			await sendBatchedReplies(threadId, threadState, filteredReplies, page);

			const lastReply = replies[replies.length - 1];
			await threadStates.updateThreadState(threadId, {
				lastReplyCount: 19 * (page - 1) + replies.length,
				lastReplyId: lastReply.id,
			});
		}
	}
}

function shouldSendReply(reply: Reply, threadState: ThreadStateData): boolean {
	const isInWriterList = threadState.writer.includes(reply.user_hash);
	const isWildcardWriter = threadState.writer.includes("*");

	// If not authorized by writer list, skip
	if (!isInWriterList && !isWildcardWriter) {
		return false;
	}

	// If spam content from non-writer, skip
	if (isSpamContent(reply.content) && !isInWriterList) {
		return false;
	}

	return true;
}

function separateRepliesByImage(replies: Reply[]): {
	imageReplies: Reply[];
	textReplies: Reply[];
} {
	const imageReplies: Reply[] = [];
	const textReplies: Reply[] = [];

	for (const reply of replies) {
		if (reply.img && reply.ext) {
			imageReplies.push(reply);
		} else {
			textReplies.push(reply);
		}
	}

	return { imageReplies, textReplies };
}

async function createTextBatches(
	replies: Reply[],
	threadId: string,
	page: number,
): Promise<string[]> {
	const batches: string[] = [];
	let currentBatch: string[] = [];
	let currentLength = 0;
	const MAX_LENGTH = 4000;
	const SEPARATOR = "\n───────────────────\n";

	for (const reply of replies) {
		const message = await formatReplyMessage(reply, threadId, page);
		const messageLength = message.length;

		const batchLength =
			currentLength +
			messageLength +
			(currentBatch.length > 0 ? SEPARATOR.length : 0);

		if (currentBatch.length > 0 && batchLength > MAX_LENGTH) {
			batches.push(currentBatch.join(SEPARATOR));
			currentBatch = [message];
			currentLength = messageLength;
		} else {
			currentBatch.push(message);
			currentLength = batchLength;
		}
	}

	if (currentBatch.length > 0) {
		batches.push(currentBatch.join(SEPARATOR));
	}

	return batches;
}

async function sendBatchedReplies(
	threadId: string,
	threadState: ThreadStateData,
	replies: Reply[],
	page: number,
): Promise<void> {
	const { imageReplies, textReplies } = separateRepliesByImage(replies);

	for (const binding of threadState.bindings) {
		try {
			// Send image replies individually for preview support
			for (const reply of imageReplies) {
				const message = await formatReplyMessage(reply, threadId, page);
				await bot.api.sendMessage(binding.groupId, message, {
					message_thread_id: binding.topicId,
					parse_mode: "HTML",
					link_preview_options: { is_disabled: false },
				});
			}

			// Batch text-only replies
			if (textReplies.length > 0) {
				const batches = await createTextBatches(textReplies, threadId, page);
				for (const batch of batches) {
					await bot.api.sendMessage(binding.groupId, batch, {
						message_thread_id: binding.topicId,
						parse_mode: "HTML",
						link_preview_options: { is_disabled: true },
					});
				}
			}
		} catch (error) {
			console.error(`Error sending batched replies:`, error);
		}
	}
}
