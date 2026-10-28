import { z } from "zod";
import {
	CapabilityRefSchema,
	IdSchema,
	ModuleIdSchema,
	TimestampSchema,
} from "./ids.js";
import { TierSchema } from "./llm.js";
import { PolicyAskSchema } from "./policy.js";
import { err, ok, type Result } from "./result.js";
import {
	CheckpointKindSchema,
	DecisionSchema,
	MessageKindSchema,
	PauseReasonSchema,
	QuotaUnitSchema,
	TaskStatusSchema,
} from "./states.js";

// Event envelope and catalog from docs/07-domain-model-and-events.md.
// A new event type needs a payload here and a row in tab 07 in the same change.

const text = z.string().min(1);
const none = z.strictObject({});
const model = z.strictObject({ providerId: text, modelId: text });
const artifact = z.strictObject({
	artifactId: IdSchema,
	type: text,
	path: text,
});
// A pair reviewer's verdict carries its feedback, as an approver's does (ADR-136).
const review = z.strictObject({
	reviewerRoleId: text,
	decision: DecisionSchema.optional(),
	feedback: z.string().optional(),
});
const approval = z.strictObject({
	approver: text,
	decision: DecisionSchema.optional(),
	feedback: z.string().optional(),
});
// The request names the worktree the submitted files wait in, so the human can read them (ADR-132),
// and the files the task changed there (ADR-141).
const approvalRequest = approval.extend({
	worktree: text.optional(),
	files: z.array(text).optional(),
});
const quotaUnit = { providerId: text, unit: QuotaUnitSchema };
const moduleChange = z.strictObject({
	moduleId: ModuleIdSchema,
	reason: z.string().optional(),
});

const PAYLOADS = {
	"run.created": z.strictObject({ templateId: text.nullable(), goal: text }),
	"run.started": none,
	"run.paused": z.strictObject({
		reason: PauseReasonSchema,
		resumesAt: TimestampSchema.optional(),
	}),
	"run.resumed": none,
	"run.completed": z.strictObject({ summary: z.string() }),
	"run.failed": z.strictObject({ code: text, message: z.string() }),
	"run.cancelled": none,
	// The user removed an ended run (ADR-143); each module deletes its own rows of the run.
	"run.removed": none,
	// Older turns became one summary (docs/08, Agent context assembly): how many messages, how long.
	"run.summarized": z.strictObject({
		messages: z.number().int().positive(),
		chars: z.number().int().nonnegative(),
	}),
	"task.created": z.strictObject({
		title: text,
		roleId: text,
		dependsOn: z.array(IdSchema).readonly(),
	}),
	"task.assigned": z.strictObject({ agentId: IdSchema }),
	"task.status.changed": z.strictObject({
		from: TaskStatusSchema,
		to: TaskStatusSchema,
	}),
	// An approved task whose worktree did not merge into the workspace (docs/08, Parallel work and merging).
	"task.merge.failed": z.strictObject({
		code: text,
		message: z.string(),
		branch: text,
		paths: z.array(text).readonly().optional(),
	}),
	"task.clarification.requested": z.strictObject({
		toRoleId: text,
		question: text,
	}),
	"agent.created": z.strictObject({
		roleId: text,
		providerId: text,
		modelId: text,
		/** The role's tier, for the Studio card (ADR-077). */
		tier: TierSchema.optional(),
	}),
	"agent.model.changed": z.strictObject({
		from: model,
		to: model,
		reason: text,
	}),
	"agent.thinking.started": none,
	"agent.thinking.ended": z.strictObject({
		/** The token counts of the model call it closes, when the call finished (ADR-090). */
		usage: z
			.strictObject({
				prompt: z.number().int().nonnegative(),
				completion: z.number().int().nonnegative(),
			})
			.optional(),
	}),
	"agent.message.sent": z.strictObject({
		messageId: IdSchema,
		from: text,
		to: text,
		kind: MessageKindSchema,
		summary: z.string().max(80),
	}),
	"agent.tool.called": z.strictObject({
		capability: CapabilityRefSchema,
		adapterId: text,
	}),
	// An MCP server's progress step (ADR-067); its message is tool output and stays in the log.
	"agent.tool.progress": z.strictObject({
		capability: CapabilityRefSchema,
		progress: z.number().nonnegative(),
		total: z.number().positive().optional(),
	}),
	"agent.tool.completed": z.strictObject({
		capability: CapabilityRefSchema,
		ok: z.boolean(),
		durationMs: z.number().nonnegative(),
		// Why a failed call failed: the code only, never a message that may hold tool output.
		error: z.strictObject({ code: text }).optional(),
	}),
	"artifact.created": artifact,
	"artifact.updated": artifact,
	"verify.completed": z.strictObject({
		gate: text,
		ok: z.boolean(),
		details: z.string(),
	}),
	"review.requested": review,
	"review.completed": review,
	"approval.requested": approvalRequest,
	"approval.resolved": approval,
	"quota.consumed": z.strictObject({
		...quotaUnit,
		amount: z.number().nonnegative(),
	}),
	"quota.exhausted": z.strictObject({
		...quotaUnit,
		resetsAt: TimestampSchema,
	}),
	"quota.restored": z.strictObject(quotaUnit),
	"checkpoint.created": z.strictObject({
		kind: CheckpointKindSchema,
		ref: text,
	}),
	// The files the handoff lists as changed, so the UI can lead to them (ADR-133).
	"handoff.created": z.strictObject({
		handoffId: IdSchema,
		files: z.array(text).optional(),
	}),
	"handoff.accepted": z.strictObject({
		handoffId: IdSchema,
		byRunId: IdSchema,
	}),
	"rollback.performed": z.strictObject({ checkpointId: IdSchema }),
	"vault.note.saved": z.strictObject({ path: text, noteType: text }),
	"policy.blocked": z.strictObject({ action: text, rule: text }),
	// The policy asked about a call (ADR-121); masked, so it may follow the run.paused it caused.
	"policy.asked": PolicyAskSchema.extend({ rule: text }),
	"module.activated": moduleChange,
	"module.deactivated": moduleChange,
	"module.crashed": moduleChange,
	"module.disabled": moduleChange,
	"network.lost": none,
	"network.restored": none,
} as const;

type Payloads = typeof PAYLOADS;

/** Every event type in the catalog. */
export type EventType = keyof Payloads;

/** All catalog event types, in catalog order. */
export const EVENT_TYPES = Object.keys(PAYLOADS) as ReadonlyArray<EventType>;

const envelope = {
	id: IdSchema,
	ts: TimestampSchema,
	schema: z.literal(1),
	workspaceId: IdSchema,
	runId: IdSchema.optional(),
	taskId: IdSchema.optional(),
	agentId: IdSchema.optional(),
	source: ModuleIdSchema,
};

const eventSchema = <T extends EventType>(type: T) =>
	z.strictObject({
		...envelope,
		type: z.literal(type),
		payload: PAYLOADS[type],
	});

// map() loses the tuple type that discriminatedUnion wants; MeteEvent below restores the precise union.
/** Parses any catalog event. */
export const MeteEventSchema = z.discriminatedUnion(
	"type",
	EVENT_TYPES.map(eventSchema) as unknown as [
		ReturnType<typeof eventSchema<EventType>>,
		...ReturnType<typeof eventSchema<EventType>>[],
	],
);

/** A published event: envelope plus the payload its type defines. */
export type MeteEvent = {
	[T in EventType]: z.infer<ReturnType<typeof eventSchema<T>>>;
}[EventType];

/** Why an event failed validation. */
export type EventParseError = {
	readonly code: "invalid_event";
	readonly issues: ReadonlyArray<string>;
};

/** Validates an event before publish or after load. */
export const parseEvent = (
	input: unknown,
): Result<MeteEvent, EventParseError> => {
	const r = MeteEventSchema.safeParse(input);
	if (r.success) return ok(r.data as MeteEvent);
	return err({
		code: "invalid_event",
		issues: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
	});
};
