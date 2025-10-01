import type { Context } from "grammy";

export type ParamType = "string" | "number" | "boolean";

export interface CommandParam {
	name: string;
	type: ParamType;
	required?: boolean;
	default?: string | number | boolean;
	description?: string;
}

export type GuardType =
	| "groupOnly"
	| "threadContext"
	| "groupBinding"
	| "cookie";

export interface CommandContext {
	ctx: Context;
	groupId: string;
	threadId: string;
	cookieData: { userId: string; cookie: string };
	telegramUserId: number;
	params: Record<string, string | number | boolean>;
}

export interface CommandDefinition {
	name: string;
	description: string;
	params?: CommandParam[];
	guards?: GuardType[];
	handler: (context: CommandContext) => Promise<string | undefined>;
}
