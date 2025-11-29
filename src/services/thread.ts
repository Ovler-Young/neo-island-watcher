import type { FeedThread, Reply } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { bot } from "../bot/bot.ts";
import { config } from "../config.ts";
import { feedStates } from "../storage/feed-state.ts";
import { groupBindings } from "../storage/group-bindings.ts";
import { type ThreadStateData, threadStates } from "../storage/thread-state.ts";
import { isSpamContent } from "../utils/filter.ts";
import { formatTitle } from "../utils/title.ts";
import {
	formatReplyMessage,
	formatThreadMessage,
	splitLongMessage,
} from "./formatter.ts";
import { shouldCheckThread } from "./monitor.ts";

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
				lastNewReplyAt: new Date().toISOString(),
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

			let sentMessage: { message_id: number };
			if (thread.img && thread.ext) {
				// Try to send photo with caption if thread has image
				const imageUrl = `${config.xdnmbImageBase}/image/${thread.img}${thread.ext}`;
				try {
					sentMessage = await bot.api.sendPhoto(groupId, imageUrl, {
						caption: initialMessage,
						message_thread_id: topicId,
						parse_mode: "HTML",
						show_caption_above_media: true,
					});
				} catch (error) {
					// Fall back to text message with image link if sendPhoto fails
					console.error(
						`Failed to send photo ${imageUrl} for thread ${thread.id}, falling back to link preview:`,
						error,
					);
					const messageWithImageLink = `<a href="${imageUrl}">${thread.img}</a>\n${initialMessage}`;
					sentMessage = await bot.api.sendMessage(
						groupId,
						messageWithImageLink,
						{
							message_thread_id: topicId,
							parse_mode: "HTML",
							link_preview_options: {
								is_disabled: false,
								url: imageUrl,
								prefer_large_media: true,
							},
						},
					);
				}
			} else {
				// Send text-only message if no image
				sentMessage = await bot.api.sendMessage(groupId, initialMessage, {
					message_thread_id: topicId,
					parse_mode: "HTML",
					link_preview_options: {
						is_disabled: true,
					},
				});
			}

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

		for (const [threadId, threadState] of Object.entries(allThreads)) {
			try {
				if (!(await shouldCheckThread(threadId, threadState))) {
					const lastNewReplyAt =
						threadState.lastNewReplyAt ?? threadState.lastCheck;
					const daysSinceNewReply =
						(Date.now() - new Date(lastNewReplyAt).getTime()) /
						(1000 * 60 * 60 * 24);
					console.log(
						`⏭️  Skipping inactive thread ${threadId} (${Math.floor(daysSinceNewReply)} days since new reply)`,
					);
					continue;
				}

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

export async function checkThreadForReplies(threadId: string): Promise<void> {
	try {
		const threadState = await threadStates.getThreadState(threadId);
		if (!threadState) {
			return;
		}

		const lastCount = threadState.lastReplyCount || 0;
		const startPage = Math.max(1, Math.ceil(lastCount / 19));

		let pageData = await xdnmbClient.getThread(Number(threadId), startPage);
		const newTotalReplyCount = pageData.ReplyCount;
		let lastReply = pageData.Replies[pageData.Replies.length - 1];

		if (newTotalReplyCount <= lastCount) {
			return;
		}

		console.log(
			`📬 Thread ${threadId}: ${lastCount} -> ${newTotalReplyCount} replies`,
		);

		const maxPage = Math.ceil(newTotalReplyCount / 19);

		for (let page = startPage; page <= maxPage; page++) {
			pageData =
				page === startPage
					? pageData
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

			lastReply = newReplies[newReplies.length - 1];
			await threadStates.updateThreadState(threadId, {
				lastReplyCount: 19 * (page - 1) + newReplies.length,
				lastReplyId: lastReply.id,
			});
		}
		await threadStates.updateThreadState(threadId, {
			lastCheck: new Date().toISOString(),
			lastReplyCount: pageData.ReplyCount,
			lastReplyId: lastReply.id,
			lastNewReplyAt: new Date().toISOString(),
		});
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

	if (reply.id === 99999999) {
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
	const MAX_LENGTH = 4000;
	const SEPARATOR = "\n---\n";

	for (const binding of threadState.bindings) {
		let currentBatch: string[] = [];
		let currentLength = 0;

		for (const reply of replies) {
			const message = await formatReplyMessage(reply, threadId, page);
			const isImage = reply.img && reply.ext;

			// Split the message if it's too long
			const messageChunks = splitLongMessage(message, MAX_LENGTH);

			for (let i = 0; i < messageChunks.length; i++) {
				const chunk = messageChunks[i];
				const chunkLength = chunk.length;
				const batchLength =
					currentLength +
					chunkLength +
					(currentBatch.length > 0 ? SEPARATOR.length : 0);

				// If adding this chunk exceeds the limit, send current batch first
				if (batchLength > MAX_LENGTH && currentBatch.length > 0) {
					await bot.api.sendMessage(
						binding.groupId,
						currentBatch.join(SEPARATOR),
						{
							message_thread_id: binding.topicId,
							parse_mode: "HTML",
							link_preview_options: { is_disabled: true },
						},
					);
					currentBatch = [];
					currentLength = 0;
				}

				// Handle image replies specially
				if (isImage && i === messageChunks.length - 1) {
					// Send any accumulated batch first as text-only
					if (currentBatch.length > 0) {
						await bot.api.sendMessage(
							binding.groupId,
							currentBatch.join(SEPARATOR),
							{
								message_thread_id: binding.topicId,
								parse_mode: "HTML",
								link_preview_options: { is_disabled: true },
							},
						);
						currentBatch = [];
						currentLength = 0;
					}

					// Try to send image with caption
					const imageUrl = `${config.xdnmbImageBase}/image/${reply.img}${reply.ext}`;
					try {
						await bot.api.sendPhoto(binding.groupId, imageUrl, {
							caption: chunk,
							message_thread_id: binding.topicId,
							parse_mode: "HTML",
							show_caption_above_media: true,
						});
					} catch (error) {
						// Fall back to text message with image link if sendPhoto fails
						console.error(
							`Failed to send photo ${imageUrl} for reply ${reply.id}, falling back to link preview:`,
							error,
						);
						const messageWithImageLink = `<a href="${imageUrl}">${reply.img}</a>\n${chunk}`;
						await bot.api.sendMessage(binding.groupId, messageWithImageLink, {
							message_thread_id: binding.topicId,
							parse_mode: "HTML",
							link_preview_options: {
								is_disabled: false,
								url: imageUrl,
								prefer_large_media: true,
							},
						});
					}
				} else {
					currentBatch.push(chunk);
					currentLength +=
						chunkLength + (currentBatch.length > 1 ? SEPARATOR.length : 0);
				}
			}
		}

		if (currentBatch.length > 0) {
			await bot.api.sendMessage(binding.groupId, currentBatch.join(SEPARATOR), {
				message_thread_id: binding.topicId,
				parse_mode: "HTML",
				link_preview_options: { is_disabled: true },
			});
		}
	}
}
