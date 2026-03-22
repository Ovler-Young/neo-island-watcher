import type { Reply } from "../api/types.ts";
import { bot } from "../bot/bot.ts";
import type { ThreadStateData } from "../storage/thread-state.ts";
import { isSpamContent } from "../utils/filter.ts";
import { sendPhotoWithFallback } from "../utils/telegram.ts";
import { formatReplyMessage, splitLongMessage } from "./formatter.ts";

export function shouldSendReply(
	reply: Reply,
	threadState: ThreadStateData,
): boolean {
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

	if (reply.id === 99999999 || reply.id === 9999999) {
		return false;
	}

	return true;
}

export async function sendBatchedReplies(
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

					await sendPhotoWithFallback(
						binding.groupId,
						reply.img,
						reply.ext,
						chunk,
						binding.topicId,
					);
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
