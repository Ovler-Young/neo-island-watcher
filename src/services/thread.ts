import type { FeedThread, ThreadData } from "../api/types.ts";
import { xdnmbClient } from "../api/xdnmb.ts";
import { bot } from "../bot/bot.ts";
import { feedStates } from "../storage/feed-state.ts";
import { groupBindings } from "../storage/group-bindings.ts";
import { threadStates } from "../storage/thread-state.ts";
import { sendPhotoWithFallback } from "../utils/telegram.ts";
import { formatTitle } from "../utils/title.ts";
import { formatThreadMessage } from "./formatter.ts";
import { shouldCheckThread } from "./monitor.ts";
import { sendBatchedReplies, shouldSendReply } from "./reply-sender.ts";

const COOKIE_WARNING_INTERVAL = 24 * 60 * 60 * 1000;
const cookieWarningTimestamps = new Map<string, number>();

xdnmbClient.onCookieDisabled = async (groupId: string, error: string) => {
	const lastWarning = cookieWarningTimestamps.get(groupId);
	if (lastWarning && Date.now() - lastWarning < COOKIE_WARNING_INTERVAL) {
		return;
	}

	try {
		await bot.api.sendMessage(
			Number(groupId),
			`⚠️ 该群组提供的饼干已失效：${error}\n请使用 /setcookie 设置新的饼干。`,
		);
		cookieWarningTimestamps.set(groupId, Date.now());
	} catch (err) {
		console.error(`Failed to send cookie warning to group ${groupId}:`, err);
	}
};

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
				bindings: [{ groupId, topicId, feedUuid }],
			});

			// Sleep to avoid rate limits (as per docs)
			await new Promise((resolve) => setTimeout(resolve, 4000));

			// Send initial thread message to the topic
			const initialMessage = await formatThreadMessage(thread);

			let sentMessage: { message_id: number };
			if (thread.img && thread.ext) {
				sentMessage = await sendPhotoWithFallback(
					groupId,
					thread.img,
					thread.ext,
					initialMessage,
					topicId,
				);
			} else {
				// Send text-only message if no image
				sentMessage = await bot.api.sendMessage(groupId, initialMessage, {
					message_thread_id: topicId,
					parse_mode: "HTML",
					link_preview_options: { is_disabled: true },
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
		const threadsToCheck: { threadId: string; startPage: number }[] = [];

		for (const [threadId, threadState] of Object.entries(allThreads)) {
			if (!(await shouldCheckThread(threadId, threadState))) {
				continue;
			}

			const startPage = Math.max(
				1,
				Math.ceil((threadState.lastReplyCount || 0) / 19),
			);
			threadsToCheck.push({ threadId, startPage });
		}

		const initialPageMap = new Map<string, ThreadData>();

		if (xdnmbClient.canUseProxyFormat && threadsToCheck.length > 1) {
			try {
				const initialPageResults = await xdnmbClient.getThreadBatch(
					threadsToCheck.map(({ threadId, startPage }) => ({
						id: Number(threadId),
						page: startPage,
					})),
				);

				for (const result of initialPageResults) {
					if (result.error || !result.data) {
						console.error(
							`Error prefetching thread ${result.id} page ${result.page}: ${result.error ?? "Missing thread data"}`,
						);
						continue;
					}

					initialPageMap.set(`${result.id}:${result.page}`, result.data);
				}
			} catch (error) {
				console.error("Error prefetching initial thread pages:", error);
			}
		}

		for (const { threadId, startPage } of threadsToCheck) {
			try {
				await checkThreadForReplies(
					threadId,
					initialPageMap.get(`${threadId}:${startPage}`),
				);
				await new Promise((resolve) => setTimeout(resolve, 500));
			} catch (error) {
				console.error(`Error checking thread ${threadId}:`, error);
			}
		}
	} catch (error) {
		console.error("Error in checkExistingThreads:", error);
	}
}

export async function checkThreadForReplies(
	threadId: string,
	initialPageData?: ThreadData,
): Promise<void> {
	try {
		const threadState = await threadStates.getThreadState(threadId);
		if (!threadState) {
			return;
		}

		const lastCount = threadState.lastReplyCount || 0;
		const startPage = Math.max(1, Math.ceil(lastCount / 19));

		let pageData =
			initialPageData ?? (await xdnmbClient.getThread(Number(threadId), startPage));
		if (!pageData?.Replies) {
			console.error(
				`Thread ${threadId} returned invalid data:`,
				JSON.stringify(pageData).slice(0, 200),
			);
			return;
		}
		const newTotalReplyCount = pageData.ReplyCount;
		let lastReply = pageData.Replies[pageData.Replies.length - 1];

		if (newTotalReplyCount <= lastCount) {
			return;
		}

		console.log(
			`📬 Thread ${threadId}: ${lastCount} -> ${newTotalReplyCount} replies`,
		);

		const maxPage = Math.ceil(newTotalReplyCount / 19);
		const remainingPages: number[] = [];
		for (let page = startPage + 1; page <= maxPage; page++) {
			remainingPages.push(page);
		}
		const remainingPageData =
			remainingPages.length > 0
				? await xdnmbClient.getThreadPages(
						Number(threadId),
						remainingPages,
						maxPage,
					)
				: [];
		const pagesToProcess = [
			{ page: startPage, data: pageData },
			...remainingPages.map((page, index) => {
				const data = remainingPageData[index];
				if (!data) {
					throw new Error(`Missing thread data for page ${page}`);
				}

				return {
					page,
					data,
				};
			}),
		];

		for (const { page, data } of pagesToProcess) {
			pageData = data;

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
