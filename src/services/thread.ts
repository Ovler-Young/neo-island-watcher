import type { FeedThread, Reply } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { bot } from "../bot/bot.ts";
import { feedStates } from "../storage/feed-state.ts";
import { groupBindings } from "../storage/group-bindings.ts";
import { type ThreadStateData, threadStates } from "../storage/thread-state.ts";
import { isSpamContent } from "../utils/filter.ts";
import { formatTitle } from "../utils/title.ts";
import { formatReplyMessage, formatThreadMessage } from "./formatter.ts";

export async function handleNewThread(
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

export async function checkExistingThreads(): Promise<void> {
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

		const lastCount = threadState.lastReplyCount || 0;
		const startPage = Math.max(1, Math.ceil(lastCount / 19));

		const firstPageData = await xdnmbClient.getThread(
			Number(threadId),
			startPage,
		);
		const newTotalReplyCount = firstPageData.ReplyCount;

		if (newTotalReplyCount <= lastCount) {
			return;
		}

		console.log(
			`📬 Thread ${threadId}: ${lastCount} -> ${newTotalReplyCount} replies`,
		);

		const maxPage = Math.ceil(newTotalReplyCount / 19);

		for (let page = startPage; page <= maxPage; page++) {
			const pageData =
				page === startPage
					? firstPageData
					: await xdnmbClient.getThread(Number(threadId), page);

			const newReplies = pageData.Replies.filter(
				(reply) => reply.id > threadState.lastReplyId,
			);

			if (newReplies.length === 0) {
				continue;
			}

			const filteredReplies = newReplies.filter((reply) =>
				shouldSendReply(reply, threadState),
			);

			if (filteredReplies.length > 0) {
				await sendBatchedReplies(threadId, threadState, filteredReplies, page);
			}

			const lastReply = newReplies[newReplies.length - 1];
			await threadStates.updateThreadState(threadId, {
				lastReplyCount: 19 * (page - 1) + newReplies.length,
				lastReplyId: lastReply.id,
			});
		}
	} catch (error) {
		console.error(`Error checking thread ${threadId} for replies:`, error);
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


async function sendBatchedReplies(
	threadId: string,
	threadState: ThreadStateData,
	replies: Reply[],
	page: number,
): Promise<void> {
	const imageReplies: Reply[] = replies.filter(reply => reply.img && reply.ext);
	const textReplies: Reply[] = replies.filter(reply => !reply.img || !reply.ext);

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