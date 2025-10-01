import type { Context } from "grammy";
import { CommandGroup } from "grammy/commands";
import { groupBindings } from "../storage/group-bindings.ts";
import { groupCookies } from "../storage/group-cookies.ts";
import { extractThreadIdFromTopic } from "../utils/telegram.ts";
import { ERROR_MESSAGES } from "./helpers/command-errors.ts";
import type {
	CommandContext,
	CommandDefinition,
	CommandParam,
	GuardType,
} from "./types.ts";

export class CommandRegistry {
	private commandGroup = new CommandGroup();

	async applyGuards(
		ctx: Context,
		guards: GuardType[],
	): Promise<CommandContext | null> {
		const context = {
			ctx,
			groupId: "",
			threadId: "",
			cookieData: { userId: "", cookie: "" },
			telegramUserId: 0,
			params: {},
		};

		for (const guard of guards) {
			if (guard === "groupOnly") {
				if (!ctx.chat || ctx.chat.type === "private") {
					await ctx.reply(ERROR_MESSAGES.GROUP_ONLY);
					return null;
				}
				context.groupId = ctx.chat.id.toString();
			}

			if (guard === "threadContext") {
				const threadId = await extractThreadIdFromTopic(ctx);
				if (!threadId) {
					await ctx.reply(ERROR_MESSAGES.NO_THREAD_ID);
					return null;
				}
				context.threadId = threadId;
			}

			if (guard === "groupBinding") {
				if (!context.groupId) continue;
				const binding = await groupBindings.getGroupBinding(context.groupId);
				if (!binding) {
					await ctx.reply(ERROR_MESSAGES.NO_GROUP_BINDING);
					return null;
				}
			}

			if (guard === "cookie") {
				if (!context.groupId) continue;
				const cookieData = await groupCookies.getCookie(context.groupId);
				if (!cookieData) {
					await ctx.reply(ERROR_MESSAGES.NO_COOKIE);
					return null;
				}
				context.cookieData = cookieData;
				await groupCookies.updateLastUsed(context.groupId);
			}
		}

		context.telegramUserId = ctx.from?.id ?? 0;
		return context;
	}

	parseParams(
		ctx: Context,
		paramDefs: CommandParam[] = [],
	): Record<string, string | number | boolean> | null {
		const args = ctx.message?.text?.split(" ").slice(1) || [];
		const params: Record<string, string | number | boolean> = {};

		for (let i = 0; i < paramDefs.length; i++) {
			const def = paramDefs[i];
			const value = args[i];

			if (!value) {
				if (def.required) {
					return null;
				}
				if (def.default !== undefined) {
					params[def.name] = def.default;
				}
				continue;
			}

			if (def.type === "number") {
				const num = Number.parseInt(value, 10);
				if (Number.isNaN(num)) return null;
				params[def.name] = num;
			} else if (def.type === "boolean") {
				params[def.name] = value === "true" || value === "1";
			} else {
				if (i === paramDefs.length - 1 && def.type === "string") {
					params[def.name] = args.slice(i).join(" ");
				} else {
					params[def.name] = value;
				}
			}
		}

		return params;
	}

	generateUsage(cmd: CommandDefinition): string {
		if (!cmd.params || cmd.params.length === 0) {
			return `Usage: /${cmd.name}`;
		}

		const paramStr = cmd.params
			.map((p) => {
				const brackets = p.required ? ["[", "]"] : ["(", ")"];
				return `${brackets[0]}${p.name}${brackets[1]}`;
			})
			.join(" ");

		let usage = `❌ Usage: /${cmd.name} ${paramStr}\n`;

		if (cmd.params.some((p) => p.description)) {
			usage += "\nParameters:\n";
			for (const p of cmd.params) {
				if (p.description) {
					usage += `  ${p.name}: ${p.description}\n`;
				}
			}
		}

		return usage.trim();
	}

	register(definition: CommandDefinition) {
		this.commandGroup.command(
			definition.name,
			definition.description,
			async (ctx: Context) => {
				try {
					const params = this.parseParams(ctx, definition.params);
					if (params === null) {
						await ctx.reply(this.generateUsage(definition));
						return;
					}

					const guardContext = await this.applyGuards(
						ctx,
						definition.guards || [],
					);
					if (guardContext === null) return;

					const result = await definition.handler({
						...guardContext,
						params,
					});

					if (result) {
						await ctx.reply(result);
					}
				} catch (error) {
					console.error(`Command ${definition.name} error:`, error);
					await ctx.reply(ERROR_MESSAGES.GENERIC_ERROR);
				}
			},
		);
	}

	registerAll(definitions: CommandDefinition[]) {
		for (const def of definitions) {
			this.register(def);
		}
		return this.commandGroup;
	}
}
