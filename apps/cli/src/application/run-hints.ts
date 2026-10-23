import type { MeteEvent } from "@mete/contracts";
import { apiKeyName } from "@mete/providers";
import type { App } from "../infrastructure/app.js";

// Only the error stream is needed; naming Io from commands.ts would make an import cycle.
type Err = { readonly err: (line: string) => void };

// The start checks of a run (ADR-044, Phase 5 onboarding): what the terminal says before a run
// starts when the folder lacks something a run relies on.

/** Said before a run starts when vcs-git is not active (docs/08: tasks then work in place). */
export const NO_GIT_LINE =
	"This folder is not a git repository (or git is not installed): tasks work in place, without worktrees or checkpoints.";

// A repository without a commit keeps vcs-git active; docs/08 logs that case when a task starts.
/** Prints the start lines for this folder. */
export const noteStart = (app: App, io: Err) => {
	if (app.inactive.some((m) => m.moduleId === "vcs-git")) io.err(NO_GIT_LINE);
};

/** The hint a pause prints under its event line. */
export const hintAt = (io: Err, e: MeteEvent) => {
	if (e.type !== "run.paused") return;
	if (e.payload.reason === "quota") io.err(QUOTA_HINT);
	if (e.payload.reason === "network") io.err(NETWORK_HINT);
};

// A network pause tries again by itself (docs/08, Single agent, Pauses).
const NETWORK_HINT =
	"The run waits for the network and tries again on its own; Ctrl+C stops it.";

// A quota pause waits for the reset; paid models can carry on meanwhile (ADR-042).
const QUOTA_HINT =
	"The run waits for the quota reset. To go on with paid models when the free ones run out, set models: both in .mete/gateway.yaml (spending is capped by dailySpendUsd, 1 US dollar a day by default).";

// The pause message of a quota pause (ADR-044): one line per provider that cannot carry the run on,
// and why, from facts the CLI already has: the inactive modules and the keychain, the quota.exhausted
// events of this run, and the gateway's usable models after the privacy rules.

const PROVIDER = "provider.chat@2";
// provider-custom is set up with endpoints in models.yaml, not with a key, so it gets no line.
const CUSTOM = "provider-custom";

const providerIds = (app: App) =>
	app.modules
		.filter(
			(m) => m.manifest.provides.includes(PROVIDER) && m.manifest.id !== CUSTOM,
		)
		.map((m) => m.manifest.id);

const inactiveLine = async (app: App, id: string) => {
	const key = await app.secrets.get(apiKeyName(id));
	return key.ok && !key.value
		? `${id}: no key (mete key set ${id})`
		: `${id}: not active; the log says why`;
};

const activeLine = (
	id: string,
	until: string | undefined,
	usable: ReadonlySet<string>,
) => {
	if (until)
		return `${id}: its free quota is used up until ${new Date(until).toLocaleString()}`;
	if (usable.has(id)) return undefined;
	return `${id}: none of its models can be used here (the privacy rules may leave them out: allowTraining in privacy.yaml; the model mode may: models in gateway.yaml; or its key was refused)`;
};

/** One line per provider that cannot carry the run on now, and why. */
export const providerLines = async (
	app: App,
	exhausted: ReadonlyMap<string, string>,
): Promise<string[]> => {
	const usable = new Set(
		(await app.models(AbortSignal.timeout(10_000))).map((m) => m.providerId),
	);
	const lines: string[] = [];
	for (const moduleId of providerIds(app)) {
		const id = moduleId.slice("provider-".length);
		const line = app.inactive.some((m) => m.moduleId === moduleId)
			? await inactiveLine(app, id)
			: activeLine(id, exhausted.get(id), usable);
		if (line) lines.push(line);
	}
	return lines;
};

/** Watches the run: after its quota pause, prints why each provider cannot help. */
export const watchQuotaPause = (
	app: App,
	io: Err,
	runId: () => string | undefined,
) => {
	const exhausted = new Map<string, string>();
	const subs = [
		app.events.subscribe("quota.exhausted", (e) => {
			exhausted.set(e.payload.providerId, e.payload.resetsAt);
		}),
		app.events.subscribe("run.paused", (e) => {
			if (e.payload.reason !== "quota" || e.runId !== runId()) return;
			void providerLines(app, exhausted).then((lines) => {
				for (const line of lines) io.err(`  ${line}`);
			});
		}),
	];
	return () => {
		for (const s of subs) s.dispose();
	};
};
