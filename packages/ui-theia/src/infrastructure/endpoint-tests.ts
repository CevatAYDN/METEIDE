import type { Result } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { customId } from "../application/endpoint-key.js";
import {
	type EndpointTestState,
	runsSkip,
} from "../application/endpoint-test.js";
import { failureText } from "../application/status-text.js";
import type {
	DaemonFailure,
	EndpointModels,
	EndpointTest,
} from "../domain/status-service.js";

// A custom endpoint's Test from the Settings card (ADR-087): `mete/provider.models` on "Test…", and
// `mete/provider.test` for the picked models on "Test", sent to the endpoint directly by the daemon.
// The params are checked here first, so a refusal can only be the daemon's not_found.

/** What a Test needs from the widget, which knows the folder. */
export type TestDeps = {
	readonly models: (
		providerId: string,
	) => Promise<Result<EndpointModels, DaemonFailure>>;
	readonly probe: (
		providerId: string,
		models: readonly string[],
	) => Promise<Result<EndpointTest, DaemonFailure>>;
	readonly onChange: () => void;
};

const IDLE: EndpointTestState = { kind: "idle" };

// A listing's failure as the daemon passed it on, its message already masked.
const listingText = (
	f: Extract<EndpointModels, { failed: unknown }>["failed"],
) =>
	nls.localize(
		"mete/settings/listFailed",
		"Listing the models failed: {0}",
		[f.code, f.status, f.message].filter((p) => p !== undefined).join(" "),
	);

const listedState = (
	r: Result<EndpointModels, DaemonFailure>,
): EndpointTestState => {
	if (!r.ok)
		return r.error.code === "refused"
			? { kind: "not_loaded" }
			: { kind: "failed", text: failureText(r.error) };
	if ("failed" in r.value)
		return { kind: "failed", text: listingText(r.value.failed) };
	const { models } = r.value;
	return {
		kind: "listed",
		models: models.map((m) => m.id),
		skipped: models.filter(runsSkip).map((m) => m.id),
		picked: [],
		testing: false,
	};
};

/** Each endpoint's Test by slug. */
export class EndpointTests {
	protected readonly states = new Map<string, EndpointTestState>();

	constructor(protected readonly deps: TestDeps) {}

	stateOf(slug: string): EndpointTestState {
		return this.states.get(slug) ?? IDLE;
	}

	/** Forgets every answer: a restarted daemon may have loaded other endpoints. */
	reset() {
		this.states.clear();
		this.deps.onChange();
	}

	async list(slug: string) {
		const id = customId(slug);
		if (!id) return;
		this.put(slug, { kind: "loading" });
		this.put(slug, listedState(await this.deps.models(id)));
	}

	pick(slug: string, model: string, on: boolean) {
		const state = this.stateOf(slug);
		if (state.kind !== "listed") return;
		const rest = state.picked.filter((m) => m !== model);
		this.put(slug, { ...state, picked: on ? [...rest, model] : rest });
	}

	async probe(slug: string) {
		const id = customId(slug);
		const state = this.stateOf(slug);
		if (!id || state.kind !== "listed" || state.testing) return;
		if (state.picked.length === 0) return;
		const { problem: _, ...asked } = state;
		this.put(slug, { ...asked, testing: true });
		const r = await this.deps.probe(id, state.picked);
		this.put(
			slug,
			r.ok
				? { ...asked, testing: false, results: r.value.results }
				: { ...asked, testing: false, problem: failureText(r.error) },
		);
	}

	protected put(slug: string, state: EndpointTestState) {
		this.states.set(slug, state);
		this.deps.onChange();
	}
}
