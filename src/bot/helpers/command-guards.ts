import type { Context } from "grammy";
import { groupBindings } from "../../storage/group-bindings.ts";
import { groupCookies } from "../../storage/group-cookies.ts";
import { extractThreadIdFromTopic } from "../../utils/telegram.ts";
import { ERROR_MESSAGES } from "./command-errors.ts";

export async function ensureGroupChat(ctx: Context) {
	if (!ctx.chat || ctx.chat.type === "private") {
		await ctx.reply(ERROR_MESSAGES.GROUP_ONLY);
		return null;
	}
	return ctx.chat;
}

export async function ensureThreadContext(
	ctx: Context,
): Promise<string | null> {
	const threadId = await extractThreadIdFromTopic(ctx);
	if (!threadId) {
		await ctx.reply(ERROR_MESSAGES.NO_THREAD_ID);
		return null;
	}
	return threadId;
}

export async function ensureGroupBinding(ctx: Context) {
	if (!ctx.chat) return null;

	const groupBinding = await groupBindings.getGroupBinding(
		ctx.chat.id.toString(),
	);
	if (!groupBinding) {
		await ctx.reply(ERROR_MESSAGES.NO_GROUP_BINDING);
		return null;
	}
	return groupBinding;
}

export async function ensureCookie(ctx: Context) {
	if (!ctx.chat) return null;

	const groupId = ctx.chat.id.toString();
	const cookieData = await groupCookies.getCookie(groupId);
	if (!cookieData) {
		await ctx.reply(ERROR_MESSAGES.NO_COOKIE);
		return null;
	}
	return { groupId, cookieData };
}

export function withErrorHandler<T extends Context>(
	handler: (ctx: T) => Promise<void>,
	errorMessage: string = ERROR_MESSAGES.GENERIC_ERROR,
) {
	return async (ctx: T) => {
		try {
			await handler(ctx);
		} catch (error) {
			console.error("Command error:", error);
			await ctx.reply(errorMessage);
		}
	};
}
