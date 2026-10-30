import type { ModelRef } from "@mete/contracts";
import type { AgentCard } from "@mete/ui-studio";
import type { MeteDaemonService } from "../domain/status-service.js";
import {
	type ChainContext,
	fetchChain,
	type PickerFacts,
	pickerFacts,
} from "./composer.js";
import {
	chainsOfRoles,
	needsFor,
	needsOfRoles,
	preferredOf,
} from "./role-chains.js";
import type { RunEntry } from "./run-hero.js";
import { failureText, plain } from "./status-text.js";

// The shown run's model choice for the Team panel (ADR-122): each member's candidate models, asked once
// per role for its tier and the needs its seat names, and the models the run prefers by role. An answer
// for a run no longer shown is dropped, and a refused change is said, never silent.

type Deps = {
	readonly daemon: MeteDaemonService;
	readonly onChange: () => void;
	readonly warn: (text: string) => void;
};

type Run = { readonly dir: string; readonly runId: string };

type Box = {
	shown?: Run | undefined;
	/** The run's team, or null for a single agent; unknown until the run says. */
	templateId: string | null | undefined;
	needs: Readonly<Record<string, readonly string[]>>;
	candidates: Readonly<Record<string, readonly string[]>>;
	preferred: Readonly<Record<string, string>>;
	cache: Map<string, readonly string[]>;
	asked: Set<string>;
	/** The candidates' facts and the providers' states (ADR-161). */
	picker?: PickerFacts | undefined;
};

const fresh = (shown?: Run): Box => ({
	shown,
	templateId: undefined,
	needs: {},
	candidates: {},
	preferred: {},
	cache: new Map(),
	asked: new Set(),
});

const ctxOf = (deps: Deps, b: Box, run: Run): ChainContext => ({
	daemon: deps.daemon,
	dir: run.dir,
	cache: b.cache,
});

// The candidates' facts and the providers' states, asked again each time new candidates came (ADR-161).
const askFacts = async (deps: Deps, b: Box, run: Run) => {
	const listed = Object.values(b.candidates).flat();
	const picker = await pickerFacts(deps.daemon, run.dir, listed);
	if (b.shown !== run) return;
	b.picker = picker;
	deps.onChange();
};

// Each member's chain, asked for the needs its role names, or the single agent's tool calling.
const askChains = async (deps: Deps, b: Box, agents: readonly AgentCard[]) => {
	const run = b.shown;
	if (!run) return;
	const before = Object.keys(b.candidates).length;
	for (const a of agents) {
		if (b.candidates[a.roleId] || b.asked.has(a.roleId)) continue;
		b.asked.add(a.roleId);
		const models = await fetchChain(
			ctxOf(deps, b, run),
			a.tier ?? "coder",
			needsFor(b.templateId, b.needs, a.roleId),
		);
		if (b.shown !== run) return;
		b.candidates = { ...b.candidates, [a.roleId]: models };
		deps.onChange();
	}
	if (Object.keys(b.candidates).length > before) await askFacts(deps, b, run);
};

// Every role of the team file at once, so a member shows its choice before its first agent starts.
const loadTemplate = async (deps: Deps, b: Box, yaml: string) => {
	const run = b.shown;
	if (!run) return;
	b.needs = needsOfRoles(yaml);
	const models = await chainsOfRoles(ctxOf(deps, b, run), yaml);
	if (b.shown !== run) return;
	for (const id of Object.keys(models)) b.asked.add(id);
	b.candidates = { ...b.candidates, ...models };
	deps.onChange();
	await askFacts(deps, b, run);
};

// A single agent's run takes one model; a team's takes it for the role.
const setModel = async (
	deps: Deps,
	b: Box,
	roleId: string,
	model: ModelRef | null,
) => {
	const run = b.shown;
	if (!run) return;
	const role = b.templateId === null ? undefined : roleId;
	const r = await deps.daemon.model(run.dir, run.runId, model, role);
	if (!r.ok) return deps.warn(failureText(r.error, plain));
	if (b.shown !== run) return;
	const next = { ...b.preferred };
	if (model) next[roleId] = `${model.providerId}/${model.modelId}`;
	else delete next[roleId];
	b.preferred = next;
	deps.onChange();
};

/** The model choice of the run the panel shows. */
export const createModelSession = (deps: Deps) => {
	const b = fresh();
	return {
		get candidates(): Readonly<Record<string, readonly string[]>> {
			return b.candidates;
		},
		get preferred(): Readonly<Record<string, string>> {
			return b.preferred;
		},
		get picker(): PickerFacts | undefined {
			return b.picker;
		},
		/** Shows a run: what the last one asked is forgotten. */
		show: (dir: string, runId: string) => {
			Object.assign(b, fresh({ dir, runId }));
		},
		/** The run's team as its run.created event names it. */
		setTemplate: (templateId: string | null) => {
			b.templateId = templateId;
		},
		/** The run's entry of mete/status: its team and the models it prefers. */
		onRun: (run: RunEntry, singleRole: string) => {
			if (run.templateId !== undefined) b.templateId = run.templateId;
			b.preferred = preferredOf(run.prefer, singleRole);
		},
		askChains: (agents: readonly AgentCard[]) => askChains(deps, b, agents),
		loadTemplate: (yaml: string) => loadTemplate(deps, b, yaml),
		setModel: (roleId: string, model: ModelRef | null) =>
			setModel(deps, b, roleId, model),
	};
};

/** The session the Team panel keeps. */
export type ModelSession = ReturnType<typeof createModelSession>;
