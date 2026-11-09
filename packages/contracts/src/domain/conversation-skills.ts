import type { z } from "zod";
import {
	type ConversationThreadV2Adapter,
	ThreadContextReplyInputSchema,
	ThreadContextStartInputSchema,
} from "./conversation-context.js";
import type { ThreadStarted } from "./conversation-thread.js";
import type { EngineError } from "./engine.js";
import type { Result } from "./result.js";
import { SkillPolicySchema } from "./skill-runtime.js";

/** New S2 starts default to auto without explicit source authority (ADR-190). */
export const ThreadSkillsStartInputSchema =
	ThreadContextStartInputSchema.extend({
		skills: SkillPolicySchema.default(() => ({
			mode: "auto" as const,
			selected: [],
		})),
	});
/** Omission inherits predecessor mode only; no reply default renews selections. */
export const ThreadSkillsReplyInputSchema =
	ThreadContextReplyInputSchema.extend({
		skills: SkillPolicySchema.optional(),
	});

/** Unparsed S2 start intent retains optional defaults and explicit editor context. */
export type ThreadSkillsStartInput = z.input<
	typeof ThreadSkillsStartInputSchema
>;
/** Unparsed S2 reply keeps policy omission distinct from explicit auto/manual/off. */
export type ThreadSkillsReplyInput = z.input<
	typeof ThreadSkillsReplyInputSchema
>;

/** conversation.thread@3 changes only mutation inputs; @1/@2 remain unchanged. */
export interface ConversationThreadV3Adapter
	extends Omit<ConversationThreadV2Adapter, "start" | "reply"> {
	start(
		input: ThreadSkillsStartInput,
	): Promise<Result<ThreadStarted, EngineError>>;
	reply(
		input: ThreadSkillsReplyInput,
	): Promise<Result<ThreadStarted, EngineError>>;
}
