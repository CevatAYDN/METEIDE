import type { MeteEvent } from "@mete/contracts";

// A run's section of the workspace journal (docs/11, Run reports; ADR-144): built from the run's
// persisted events without a model call. Prompts and tool output never come in: the events carry
// none, and a failed call keeps only its error code.

type Ended = "completed" | "failed" | "cancelled";

/** What the report says about one run. */
export type RunFacts = {
	goal?: string;
	templateId?: string | null;
	status?: Ended;
	code?: string;
	summary?: string;
	readonly models: Set<string>;
	readonly calls: Map<string, number>;
	readonly failed: Map<string, number>;
	checkpoints: number;
	files: readonly string[];
};

type Take = {
	[T in MeteEvent["type"]]?: (
		f: RunFacts,
		e: Extract<MeteEvent, { type: T }>,
	) => void;
};

const bump = (m: Map<string, number>, key: string) =>
	m.set(key, (m.get(key) ?? 0) + 1);

const TAKE: Take = {
	"run.created": (f, e) => {
		f.goal = e.payload.goal;
		f.templateId = e.payload.templateId;
	},
	"run.completed": (f, e) => {
		f.status = "completed";
		f.summary = e.payload.summary;
	},
	"run.failed": (f, e) => {
		f.status = "failed";
		f.code = e.payload.code;
	},
	"run.cancelled": (f) => {
		f.status = "cancelled";
	},
	"agent.created": (f, e) =>
		f.models.add(`${e.payload.providerId}/${e.payload.modelId}`),
	"agent.model.changed": (f, e) =>
		f.models.add(`${e.payload.to.providerId}/${e.payload.to.modelId}`),
	"agent.tool.completed": (f, e) => {
		bump(f.calls, e.payload.capability);
		if (!e.payload.ok)
			bump(
				f.failed,
				`${e.payload.capability} (${e.payload.error?.code ?? "unknown"})`,
			);
	},
	"checkpoint.created": (f) => {
		f.checkpoints += 1;
	},
	// The latest handoff is the one the run left when it ended (docs/08, Run memory).
	"handoff.created": (f, e) => {
		f.files = e.payload.files ?? [];
	},
};

/** Folds a run's events, in order, into its report's facts. */
export const factsOf = (events: readonly MeteEvent[]): RunFacts => {
	const f: RunFacts = {
		models: new Set(),
		calls: new Map(),
		failed: new Map(),
		checkpoints: 0,
		files: [],
	};
	for (const e of events)
		(TAKE[e.type] as ((f: RunFacts, e: MeteEvent) => void) | undefined)?.(f, e);
	return f;
};

const counted = (m: ReadonlyMap<string, number>) =>
	[...m].map(([k, n]) => (n > 1 ? `${k} × ${n}` : k)).join(", ") || "none";

const statusLine = (f: RunFacts) =>
	f.status === "failed" ? `failed (${f.code})` : (f.status ?? "unknown");

const titleOf = (goal: string | undefined) => {
	const line = (goal ?? "").split("\n")[0]?.trim() || "Untitled run";
	return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/** The run's Markdown section: a heading, one line per fact, and the summary quoted. */
export const reportOf = (runId: string, endedAt: string, f: RunFacts) => {
	const lines = [
		`## ${titleOf(f.goal)}`,
		"",
		`- Run: ${runId}, ended ${endedAt}`,
		`- Team: ${f.templateId ?? "single agent"}`,
		`- Status: ${statusLine(f)}`,
		`- Models: ${[...f.models].join(", ") || "none"}`,
		`- Tool calls: ${counted(f.calls)}`,
	];
	if (f.failed.size > 0) lines.push(`- Failed calls: ${counted(f.failed)}`);
	lines.push(
		`- Checkpoints: ${f.checkpoints}`,
		`- Changed files: ${f.files.map((p) => `\`${p}\``).join(", ") || "none"}`,
	);
	if (f.summary?.trim())
		lines.push(
			"",
			...f.summary
				.trim()
				.split("\n")
				.map((l) => `> ${l}`),
		);
	return `${lines.join("\n")}\n`;
};
