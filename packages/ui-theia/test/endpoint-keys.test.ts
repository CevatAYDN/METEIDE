import { describe, expect, it } from "vitest";
import type { DaemonFailure } from "../src/domain/status-service.js";
import { EndpointKeys } from "../src/infrastructure/endpoint-keys.js";

// A custom endpoint's API key from the card (ADR-087): set through `mete key set` as custom:<slug>,
// never while a run of the folder is queued or running, since the daemon restarts.

type Done = { ok: true; value: null } | { ok: false; error: DaemonFailure };

const setup = (
	opts: {
		runs?: number;
		saved?: Done;
		idOf?: (name: string) => string | undefined;
	} = {},
) => {
	const set: [string, string][] = [];
	let saved = 0;
	const keys = new EndpointKeys({
		setKey: async (id, key) => {
			set.push([id, key]);
			return opts.saved ?? { ok: true, value: null };
		},
		activeRuns: async () => opts.runs ?? 0,
		onSaved: () => void saved++,
		onChange: () => {},
		...(opts.idOf ? { idOf: opts.idOf } : {}),
	});
	return { keys, set, saved: () => saved };
};

describe("a custom endpoint's key from the card", () => {
	it("sets the key of custom:<slug>, clears the field and loads the screen again", async () => {
		const { keys, set, saved } = setup();
		keys.type("my-lab", " sk-test ");
		await keys.set("my-lab");
		expect(set).toEqual([["custom:my-lab", "sk-test"]]);
		expect(keys.stateOf("my-lab")).toEqual({
			key: "",
			busy: false,
			note: { kind: "saved", text: "Key saved; METE restarted to use it." },
		});
		expect(saved()).toBe(1);
	});

	it("waits while a run is queued or running, and keeps the key", async () => {
		const { keys, set, saved } = setup({ runs: 1 });
		keys.type("my-lab", "sk-test");
		await keys.set("my-lab");
		expect(set).toEqual([]);
		expect(keys.stateOf("my-lab").key).toBe("sk-test");
		expect(keys.stateOf("my-lab").note?.kind).toBe("refused");
		expect(keys.stateOf("my-lab").note?.text).toContain("A run is running");
		expect(saved()).toBe(0);
	});

	it("says why mete key set failed, keeps the key for another try, and never puts it in the note", async () => {
		const { keys, saved } = setup({
			saved: { ok: false, error: { code: "cli", detail: "keychain locked" } },
		});
		keys.type("my-lab", "sk-test");
		await keys.set("my-lab");
		const state = keys.stateOf("my-lab");
		expect(state.key).toBe("sk-test");
		expect(state.busy).toBe(false);
		expect(state.note?.kind).toBe("refused");
		expect(state.note?.text).toContain("keychain locked");
		expect(state.note?.text).not.toContain("sk-test");
		expect(saved()).toBe(0);
	});

	it("keeps a typed key with its endpoint while the slug is edited", async () => {
		const { keys, set } = setup();
		keys.type("my-lab", "sk-test");
		keys.rename("my-lab", "my-");
		keys.rename("my-", "my-lab2");
		expect(keys.stateOf("my-lab").key).toBe("");
		expect(keys.stateOf("my-lab2").key).toBe("sk-test");
		await keys.set("my-lab2");
		expect(set).toEqual([["custom:my-lab2", "sk-test"]]);
	});

	it("leaves a key that is being set with the slug it is set for", async () => {
		let done: (r: Done) => void = () => {};
		let asked = () => {};
		const started = new Promise<void>((resolve) => {
			asked = resolve;
		});
		const keys = new EndpointKeys({
			setKey: () => {
				asked();
				return new Promise<Done>((resolve) => {
					done = resolve;
				});
			},
			activeRuns: async () => 0,
			onSaved: () => {},
			onChange: () => {},
		});
		keys.type("my-lab", "sk-test");
		const setting = keys.set("my-lab");
		await started;
		keys.rename("my-lab", "other");
		expect(keys.stateOf("other").key).toBe("");
		done({ ok: true, value: null });
		await setting;
		expect(keys.stateOf("my-lab").busy).toBe(false);
		expect(keys.stateOf("other").busy).toBe(false);
	});

	it("drops the typed key of a removed endpoint", () => {
		const { keys } = setup();
		keys.type("my-lab", "sk-test");
		keys.forget("my-lab");
		expect(keys.stateOf("my-lab").key).toBe("");
	});

	it("sets a built-in provider's key under its own id on the Welcome screen", async () => {
		const { keys, set } = setup({ idOf: (id) => id });
		keys.type("nvidia", "nvapi-x");
		await keys.set("nvidia");
		// customId would take "nvidia" as a slug and store the key as custom:nvidia.
		expect(set).toEqual([["nvidia", "nvapi-x"]]);
	});

	it("does nothing for a slug that is not one or an empty key", async () => {
		const { keys, set } = setup();
		keys.type("My Lab", "sk-test");
		await keys.set("My Lab");
		keys.type("my-lab", "  ");
		await keys.set("my-lab");
		expect(set).toEqual([]);
	});
});
