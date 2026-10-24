import type { Result } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { customId, type EndpointKey } from "../application/endpoint-key.js";
import { failureText } from "../application/status-text.js";
import type { DaemonFailure } from "../domain/status-service.js";

// A custom endpoint's API key from the Settings card (ADR-087): set as custom:<slug> through
// `mete key set`, the key on standard input (ADR-049). Setting it restarts the daemon, which pauses a
// running run (ADR-061), so it waits while a run is queued or running, asked again just before.

/** What setting a key needs from the widget. */
export type KeyDeps = {
	readonly setKey: (
		providerId: string,
		key: string,
	) => Promise<Result<null, DaemonFailure>>;
	readonly activeRuns: () => Promise<number>;
	/** The daemon restarted, so the screen loads what it now loaded. */
	readonly onSaved: () => void;
	readonly onChange: () => void;
};

const IDLE: EndpointKey = { key: "", busy: false };

/** The typed key of each endpoint by slug, and setting it. */
export class EndpointKeys {
	protected readonly states = new Map<string, EndpointKey>();

	constructor(protected readonly deps: KeyDeps) {}

	stateOf(slug: string): EndpointKey {
		return this.states.get(slug) ?? IDLE;
	}

	type(slug: string, key: string) {
		this.put(slug, { ...this.stateOf(slug), key, note: undefined });
	}

	/** The endpoint's slug was edited, so its typed key moves with it; a key being set stays put. */
	// shortcut: renaming onto another endpoint's slug takes over its typed key; duplicate slugs cannot be saved.
	rename(from: string, to: string) {
		const state = this.states.get(from);
		if (!state || from === to || state.busy) return;
		this.states.delete(from);
		this.put(to, state);
	}

	/** The endpoint left the card, so its typed key goes too. */
	forget(slug: string) {
		if (this.states.delete(slug)) this.deps.onChange();
	}

	async set(slug: string) {
		const id = customId(slug);
		const state = this.stateOf(slug);
		const key = state.key.trim();
		if (!id || !key || state.busy) return;
		if ((await this.deps.activeRuns()) > 0)
			return this.put(slug, { ...state, note: refused(waitText()) });
		this.put(slug, { ...state, busy: true, note: undefined });
		const r = await this.deps.setKey(id, key);
		if (!r.ok)
			return this.put(slug, { ...state, note: refused(failureText(r.error)) });
		this.put(slug, {
			key: "",
			busy: false,
			note: { kind: "saved", text: savedText() },
		});
		this.deps.onSaved();
	}

	protected put(slug: string, state: EndpointKey) {
		this.states.set(slug, state);
		this.deps.onChange();
	}
}

const refused = (text: string) => ({ kind: "refused" as const, text });

const waitText = () =>
	nls.localize(
		"mete/settings/keyWaits",
		"A run is running; setting a key restarts METE, so it waits until the run is paused or ends.",
	);

const savedText = () =>
	nls.localize("mete/key/saved", "Key saved; METE restarted to use it.");
