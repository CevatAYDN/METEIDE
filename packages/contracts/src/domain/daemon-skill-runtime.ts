import { z } from "zod";
import {
	ThreadSkillsReplyInputSchema,
	ThreadSkillsStartInputSchema,
} from "./conversation-skills.js";
import { ThreadStartedSchema } from "./conversation-thread.js";
import { DaemonRunStartResultSchema } from "./daemon.js";
import { IdSchema } from "./ids.js";
import {
	RunSkillsReadInputSchema,
	RunSkillsReadResultSchema,
} from "./run-skills.js";
import { RunSkillsStartInputSchema } from "./run-skills-input.js";
import {
	SkillRuntimeCatalogSchema,
	SkillRuntimeErrorSchema,
} from "./skill-runtime-catalog.js";

const session = { sessionId: IdSchema };
const failed = z.strictObject({
	ok: z.literal(false),
	error: SkillRuntimeErrorSchema,
});

/** Initial runtime catalog request; no caller-owned session or authority claim. */
export const DaemonSkillsRuntimeParamsSchema = z.strictObject({});
/** Session-bound thread start retains the capability's exact defaults and fields. */
export const DaemonThreadSkillsStartParamsSchema =
	ThreadSkillsStartInputSchema.extend(session);
/** Session-bound reply preserves omitted policy as inheritance of mode only. */
export const DaemonThreadSkillsReplyParamsSchema =
	ThreadSkillsReplyInputSchema.extend(session);
/** Session-bound run start retains goal, router, role and selection refinements. */
export const DaemonRunSkillsStartParamsSchema =
	RunSkillsStartInputSchema.safeExtend(session);
/** Exact run/context read; stale-read identity is captured by the transport. */
export const DaemonRunSkillsReadParamsSchema = RunSkillsReadInputSchema;

/** Complete catalog and daemon identity, or a safe typed runtime failure. */
export const DaemonSkillsRuntimeResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({
		ok: z.literal(true),
		value: z.strictObject({ ...session, catalog: SkillRuntimeCatalogSchema }),
	}),
	failed,
]);
/** Retained evidence keeps its existing validation; failure is never empty data. */
export const DaemonRunSkillsReadResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({
		ok: z.literal(true),
		value: RunSkillsReadResultSchema,
	}),
	failed,
]);
/** Bare thread-start success; engine failures retain the existing JSON-RPC map. */
export const DaemonThreadSkillsStartResultSchema = ThreadStartedSchema;
/** Bare reply success reuses the existing immutable conversation/run identity. */
export const DaemonThreadSkillsReplyResultSchema = ThreadStartedSchema;
/** Bare run-start success; no new typed mutation-failure envelope. */
export const DaemonRunSkillsStartResultSchema = DaemonRunStartResultSchema;

/** Empty catalog request. */
export type DaemonSkillsRuntimeParams = z.infer<
	typeof DaemonSkillsRuntimeParamsSchema
>;
/** Session-qualified catalog or precise runtime refusal. */
export type DaemonSkillsRuntimeResult = z.infer<
	typeof DaemonSkillsRuntimeResultSchema
>;
/** Unparsed thread start with required session identity and optional defaults. */
export type DaemonThreadSkillsStartParams = z.input<
	typeof DaemonThreadSkillsStartParamsSchema
>;
/** Unparsed reply with required session identity and optional skill policy. */
export type DaemonThreadSkillsReplyParams = z.input<
	typeof DaemonThreadSkillsReplyParamsSchema
>;
/** Unparsed run start with required session identity and optional defaults. */
export type DaemonRunSkillsStartParams = z.input<
	typeof DaemonRunSkillsStartParamsSchema
>;
/** Exact run and optional context read request. */
export type DaemonRunSkillsReadParams = z.infer<
	typeof DaemonRunSkillsReadParamsSchema
>;
/** Existing run-read evidence or a safe runtime refusal. */
export type DaemonRunSkillsReadResult = z.infer<
	typeof DaemonRunSkillsReadResultSchema
>;
/** Existing thread-start success identity. */
export type DaemonThreadSkillsStartResult = z.infer<
	typeof DaemonThreadSkillsStartResultSchema
>;
/** Existing thread-reply success identity. */
export type DaemonThreadSkillsReplyResult = z.infer<
	typeof DaemonThreadSkillsReplyResultSchema
>;
/** Existing run-start success identity. */
export type DaemonRunSkillsStartResult = z.infer<
	typeof DaemonRunSkillsStartResultSchema
>;
