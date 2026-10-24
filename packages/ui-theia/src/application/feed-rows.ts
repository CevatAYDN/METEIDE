import type { MeteEvent } from "@mete/contracts";
import type { TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import type { Tone } from "./roster-look.js";

// The Team view's Activity feed (ADR-092): one row per event that says who did what or who asked
// whom, in the words of the Team view. One literal nls.localize call per sentence, so Theia's
// nls-extract can read each text.

/** A segment of the feed; All shows every one. */
export type FeedSegment = "asks" | "work" | "run";

/** What a feed row says: its actor and, for an ask or an answer, the one it goes to. */
export type FeedLine = {
	readonly segment: FeedSegment;
	readonly icon: string;
	readonly tone?: Tone;
	/** The role id of the member that acted, or "human". */
	readonly who?: string;
	/** The role id or "human" an ask or an answer goes to. */
	readonly to?: string;
	readonly text: string;
	/** The words an approver sent back with its answer. */
	readonly quote?: string;
};

/** An event the feed shows. */
export type Feed = Extract<
	MeteEvent,
	{
		type:
			| "task.assigned"
			| "task.status.changed"
			| "approval.requested"
			| "approval.resolved"
			| "artifact.created"
			| "artifact.updated"
			| "agent.tool.completed"
			| "agent.model.changed"
			| "run.summarized"
			| "checkpoint.created"
			| "task.merge.failed"
			| "run.paused"
			| "run.resumed"
			| "run.completed"
			| "run.failed"
			| "run.cancelled";
	}
>;
type Of<K extends Feed["type"]> = Extract<Feed, { type: K }>;
type Lines = {
	readonly [K in Feed["type"]]: (v: TeamView, e: Of<K>) => FeedLine;
};

const title = (v: TeamView, e: MeteEvent) =>
	v.tasks.find((t) => t.id === e.taskId)?.title ?? "";
const taskRole = (v: TeamView, e: MeteEvent) =>
	v.tasks.find((t) => t.id === e.taskId)?.roleId;
// The acting agent's role, else its task's: a member's first turn carries no agent id yet.
const actor = (v: TeamView, e: MeteEvent) =>
	v.agents.find((a) => a.id === e.agentId)?.roleId ?? taskRole(v, e);
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const modelName = (m: { providerId: string; modelId: string }) =>
	`${m.providerId}/${m.modelId}`;
const opt = <K extends string>(key: K, value: string | undefined) =>
	value ? ({ [key]: value } as { [P in K]: string }) : {};

const asks: Pick<
	Lines,
	| "task.assigned"
	| "task.status.changed"
	| "approval.requested"
	| "approval.resolved"
> = {
	"task.assigned": (v, e) => ({
		segment: "asks",
		icon: "arrow-right",
		...opt(
			"who",
			v.agents.find((a) => a.id === e.payload.agentId)?.roleId ??
				taskRole(v, e),
		),
		text: nls.localize("mete/feed/takes", "takes “{0}”", title(v, e)),
	}),
	"task.status.changed": (v, e) => ({
		segment: "asks",
		icon: "error",
		tone: "bad",
		...opt("who", taskRole(v, e)),
		text: nls.localize("mete/feed/blocked", "is blocked on “{0}”", title(v, e)),
	}),
	"approval.requested": (v, e) => ({
		segment: "asks",
		icon: "comment-discussion",
		...opt("who", taskRole(v, e)),
		to: e.payload.approver,
		text: nls.localize(
			"mete/feed/asks",
			"asks for approval of “{0}”",
			title(v, e),
		),
	}),
	"approval.resolved": (v, e) => ({
		segment: "asks",
		...(e.payload.decision === "approve"
			? {
					icon: "check",
					tone: "good",
					text: nls.localize(
						"mete/feed/approves",
						"approves “{0}”",
						title(v, e),
					),
				}
			: {
					icon: "comment",
					tone: "warn",
					text: nls.localize(
						"mete/feed/revises",
						"asks for changes to “{0}”",
						title(v, e),
					),
				}),
		who: e.payload.approver,
		...opt("to", taskRole(v, e)),
		...opt("quote", e.payload.feedback),
	}),
};

const work: Pick<
	Lines,
	"artifact.created" | "artifact.updated" | "agent.tool.completed"
> = {
	"artifact.created": (v, e) => ({
		segment: "work",
		icon: "new-file",
		...opt("who", actor(v, e)),
		text: nls.localize(
			"mete/feed/writes",
			"writes {0}",
			fileName(e.payload.path),
		),
	}),
	"artifact.updated": (v, e) => ({
		segment: "work",
		icon: "file",
		...opt("who", actor(v, e)),
		text: nls.localize(
			"mete/feed/updates",
			"updates {0}",
			fileName(e.payload.path),
		),
	}),
	"agent.tool.completed": (v, e) => ({
		segment: "work",
		...(e.payload.ok
			? {
					icon: "tools",
					text: nls.localize(
						"mete/feed/tool",
						"uses {0} · {1} ms",
						e.payload.capability,
						Math.round(e.payload.durationMs),
					),
				}
			: {
					icon: "warning",
					tone: "bad",
					text: nls.localize(
						"mete/feed/toolFailed",
						"uses {0}, which fails: {1}",
						e.payload.capability,
						e.payload.error?.code ?? "",
					),
				}),
		...opt("who", actor(v, e)),
	}),
};

const member: Pick<
	Lines,
	"agent.model.changed" | "run.summarized" | "task.merge.failed"
> = {
	"agent.model.changed": (v, e) => ({
		segment: "run",
		icon: "arrow-swap",
		tone: "warn",
		...opt("who", actor(v, e)),
		text: nls.localize(
			"mete/feed/model",
			"switches from {0} to {1}: {2}",
			modelName(e.payload.from),
			modelName(e.payload.to),
			e.payload.reason,
		),
	}),
	"run.summarized": (v, e) => ({
		segment: "run",
		icon: "fold",
		...opt("who", actor(v, e)),
		text: nls.localize(
			"mete/feed/summarized",
			"has {0} older messages summarized",
			e.payload.messages,
		),
	}),
	"task.merge.failed": (v, e) => ({
		segment: "run",
		icon: "git-merge",
		tone: "bad",
		...opt("who", taskRole(v, e)),
		text: nls.localize(
			"mete/feed/mergeFailed",
			"“{0}” does not merge: {1}",
			title(v, e),
			e.payload.code,
		),
	}),
};

const run: Omit<
	Lines,
	keyof typeof asks | keyof typeof work | keyof typeof member
> = {
	"checkpoint.created": () => ({
		segment: "run",
		icon: "history",
		text: nls.localize("mete/feed/checkpoint", "A checkpoint is saved."),
	}),
	"run.paused": (_, e) => ({
		segment: "run",
		icon: "debug-pause",
		tone: "warn",
		text: nls.localize(
			"mete/feed/paused",
			"The run pauses: {0}.",
			e.payload.reason,
		),
	}),
	"run.resumed": () => ({
		segment: "run",
		icon: "debug-start",
		text: nls.localize("mete/feed/resumed", "The run resumes."),
	}),
	"run.completed": () => ({
		segment: "run",
		icon: "pass",
		tone: "good",
		text: nls.localize("mete/feed/completed", "The run is complete."),
	}),
	"run.failed": (_, e) => ({
		segment: "run",
		icon: "error",
		tone: "bad",
		text: nls.localize(
			"mete/feed/failed",
			"The run fails: {0}.",
			e.payload.code,
		),
	}),
	"run.cancelled": () => ({
		segment: "run",
		icon: "circle-slash",
		text: nls.localize("mete/feed/cancelled", "The run is cancelled."),
	}),
};

const LINES: Lines = { ...asks, ...work, ...member, ...run };

/** Whether the feed shows an event: a status change only when its task is blocked. */
export const inFeed = (e: MeteEvent): e is Feed =>
	Object.hasOwn(LINES, e.type) &&
	(e.type !== "task.status.changed" || e.payload.to === "blocked");

/** What the feed's row for an event says. */
export const feedLine = (v: TeamView, e: Feed): FeedLine =>
	// Each key's function takes its own event type; TypeScript cannot pair them through e.type.
	(LINES[e.type] as (v: TeamView, e: Feed) => FeedLine)(v, e);
