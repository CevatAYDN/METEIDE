import { z } from "zod";

// Closed sets from docs/07-domain-model-and-events.md and docs/09-models-providers-quota.md.

/** Why a run is paused. */
export const PauseReasonSchema = z.enum([
	"quota",
	"network",
	"user",
	"approval",
	"no_model",
	"budget",
]);

/** Task state machine states. */
export const TaskStatusSchema = z.enum([
	"todo",
	"in_progress",
	"submitted",
	"approved",
	"changes_requested",
	"blocked",
]);

/** Kinds of messages agents exchange. */
export const MessageKindSchema = z.enum([
	"handoff",
	"clarification",
	"answer",
	"review",
	"report",
	"feedback",
]);

/** A reviewer's or approver's decision. */
export const DecisionSchema = z.enum(["approve", "revise"]);

/** Units the quota pool measures. */
export const QuotaUnitSchema = z.enum([
	"requests_per_minute",
	"requests_per_day",
	"tokens_per_minute",
	"credits_per_month",
	"gpu_seconds_per_day",
]);

/** How a checkpoint is stored. */
export const CheckpointKindSchema = z.enum(["git", "snapshot"]);
