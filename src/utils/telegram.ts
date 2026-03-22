import { InputFile } from "grammy";
import type { Message } from "grammy/types";
import { bot } from "../bot/bot.ts";
import { config } from "../config.ts";
import { groupBindings } from "../storage/group-bindings.ts";
import { ensureImageCached } from "../storage/image-cache.ts";

export async function sendPhotoWithFallback(
	chatId: number,
	img: string,
	ext: string,
	caption: string,
	messageThreadId: number,
): Promise<{ message_id: number }> {
	const imageUrl = `${config.xdnmbImageBase}/image/${img}${ext}`;

	// Try sending by URL first
	try {
		return await bot.api.sendPhoto(chatId, imageUrl, {
			caption,
			message_thread_id: messageThreadId,
			parse_mode: "HTML",
			show_caption_above_media: true,
		});
	} catch {
		// URL failed, try local download
	}

	const imagePath = `/image/${img}${ext}`;
	const localPath = await ensureImageCached(imageUrl, imagePath);
	if (localPath) {
		try {
			const file = await Deno.open(localPath, { read: true });
			return await bot.api.sendPhoto(
				chatId,
				new InputFile(file, `${img}${ext}`),
				{
					caption,
					message_thread_id: messageThreadId,
					parse_mode: "HTML",
					show_caption_above_media: true,
				},
			);
		} catch (error) {
			console.error(`Failed to send local photo for ${img}${ext}:`, error);
		}
	}

	// Final fallback: link preview
	const messageWithImageLink = `<a href="${imageUrl}">${img}</a>\n${caption}`;
	return await bot.api.sendMessage(chatId, messageWithImageLink, {
		message_thread_id: messageThreadId,
		parse_mode: "HTML",
		link_preview_options: {
			is_disabled: false,
			url: imageUrl,
			prefer_large_media: true,
		},
	});
}
export async function extractThreadIdFromTopic(ctx: {
	message?: Message;
}): Promise<string | null> {
	if (!ctx.message) {
		return null;
	}

	const message_thread_id = ctx.message.message_thread_id;
	console.log("Extracted message_thread_id:", message_thread_id);
	if (message_thread_id) {
		return (
			(
				await groupBindings.getThreadIdFromGroup(
					ctx.message.chat.id.toString(),
					message_thread_id,
				)
			)?.toString() || null
		);
	}

	return null;
}
