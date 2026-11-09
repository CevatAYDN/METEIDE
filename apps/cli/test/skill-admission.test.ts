import {
	err,
	ok,
	type Result,
	type RunQuiesceAdapter,
	type TeamEngineV3Adapter,
} from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admitSkillMutation } from "../src/application/skill-admission.js";
import { createNativeControls } from "../src/domain/native-controls.js";
import { runLockFile, takeRunLock } from "../src/infrastructure/run-lock.js";
import { tempRepo } from "./helpers.js";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
});
const fakeEngine = (): TeamEngineV3Adapter => {
	const unsupported = async () =>
		err({ code: "not_supported" as const, message: "fixture" });
	return {
		start: unsupported,
		pause: unsupported,
		resume: unsupported,
		cancel: unsupported,
		approve: unsupported,
		status: () => ok([]),
	};
};
const setup = async (locked = true) => {
	const repo = await tempRepo({ "readme.txt": "fixture\n" });
	const registry = createCapabilityRegistry(() => ["core-engine"]);
	const lock = locked
		? await takeRunLock(runLockFile(repo.workspaceDir))
		: undefined;
	if (lock && !lock.ok) throw new Error("fixture lock failed");
	close = async () => {
		if (lock?.ok) await lock.value();
		await repo.close();
	};
	const signal = new AbortController();
	const controls = createNativeControls();
	const admit = () =>
		admitSkillMutation(
			{
				registry,
				workspaceDir: repo.workspaceDir,
				nativeControls: controls.view,
			},
			signal.signal,
		);
	const engine = () =>
		registry.provide("team.engine@3", {
			id: "fixture-engine",
			trust: "core",
			features: [],
			impl: fakeEngine(),
		});
	const quiesce = (prepare: RunQuiesceAdapter["prepare"]) =>
		registry.provide("run.quiesce@1", {
			id: "fixture-gate",
			trust: "core",
			features: [],
			impl: { prepare },
		});
	const attest = () => {
		const e = registry.resolve<TeamEngineV3Adapter>("team.engine@3");
		const q = registry.resolve<RunQuiesceAdapter>("run.quiesce@1");
		if (!e.ok || !q.ok) throw new Error("fixture pair missing");
		const pair = { engine: e.value[0].impl, quiesce: q.value[0].impl };
		controls.onNativeControls(pair);
		return pair;
	};
	return { admit, engine, quiesce, signal, registry, attest, controls };
};
const refused = (
	code: "unavailable" | "busy" | "aborted",
	admitted = false,
) => ({ admitted, result: err({ code }) });

const replaceImplementation = (
	fixture: Awaited<ReturnType<typeof setup>>,
	ref: "run.quiesce@1" | "team.engine@3",
	impl: unknown,
) => {
	const found = fixture.registry.resolve(ref);
	if (!found.ok) throw new Error("fixture adapter missing");
	Object.defineProperty(found.value[0], "impl", { value: impl });
};

const provideCounterfeitPair = (
	fixture: Awaited<ReturnType<typeof setup>>,
	prepare: RunQuiesceAdapter["prepare"],
) => {
	fixture.registry.provide("team.engine@3", {
		id: "core-engine",
		trust: "core",
		features: [],
		impl: fakeEngine(),
	});
	fixture.registry.provide("run.quiesce@1", {
		id: "core-engine",
		trust: "core",
		features: [],
		impl: { prepare },
	});
};

describe("composition-owned skill admission", () => {
	it.each([
		"unattested",
		"counterfeit",
		"mismatched-engine",
		"mismatched-gate",
		"replaced-engine",
		"replaced-gate",
	] as const)("refuses a %s pair before invoking its gate", async (target) => {
		const t = await setup();
		const engine = t.engine();
		const prepare = vi.fn<RunQuiesceAdapter["prepare"]>(async () => ok(null));
		const gate = t.quiesce(prepare);
		const pair = target === "unattested" ? undefined : t.attest();
		const interference = {
			unattested: () => {},
			counterfeit: () => provideCounterfeitPair(t, prepare),
			"mismatched-engine": () => {
				if (pair)
					t.controls.onNativeControls({ ...pair, engine: fakeEngine() });
			},
			"mismatched-gate": () => {
				if (pair)
					t.controls.onNativeControls({ ...pair, quiesce: { prepare } });
			},
			"replaced-engine": () => {
				engine.dispose();
				t.engine();
			},
			"replaced-gate": () => {
				gate.dispose();
				t.quiesce(prepare);
			},
		};
		interference[target]();
		expect(await t.admit()).toEqual(refused("unavailable"));
		expect(prepare).not.toHaveBeenCalled();
	});

	it("refuses an orphan gate without invoking it", async () => {
		const t = await setup();
		const prepare = vi.fn<RunQuiesceAdapter["prepare"]>(async () => ok(null));
		t.quiesce(prepare);
		expect(await t.admit()).toEqual(refused("unavailable"));
		expect(prepare).not.toHaveBeenCalled();
	});

	it("admits acknowledged drain for the current native pair", async () => {
		const t = await setup();
		t.engine();
		const prepare = vi.fn<RunQuiesceAdapter["prepare"]>(async () => ok(null));
		t.quiesce(prepare);
		t.attest();
		expect(await t.admit()).toEqual({
			admitted: true,
			result: ok(undefined),
		});
		expect(prepare).toHaveBeenCalledOnce();
	});

	it("admits a lock-holding process without an engine and refuses an unlocked reader", async () => {
		const t = await setup(false);
		expect(await t.admit()).toEqual(refused("unavailable"));
		await close?.();
		const locked = await setup();
		expect(await locked.admit()).toEqual({
			admitted: true,
			result: ok(undefined),
		});
	});

	it("refuses an active engine without a gate and maps active work to busy", async () => {
		const t = await setup();
		t.engine();
		expect(await t.admit()).toEqual(refused("unavailable"));
		t.quiesce(async () => err({ code: "failed", message: "Work is active" }));
		t.attest();
		expect(await t.admit()).toEqual(refused("busy"));
	});

	it("refuses cancellation before admission without closing the gate", async () => {
		const t = await setup();
		t.engine();
		const prepare = vi.fn<RunQuiesceAdapter["prepare"]>(async () => ok(null));
		t.quiesce(prepare);
		t.attest();
		t.signal.abort();
		expect(await t.admit()).toEqual(refused("aborted"));
		expect(prepare).not.toHaveBeenCalled();
	});

	it("waits for drain and retains admission in a later cancellation refusal", async () => {
		const t = await setup();
		t.engine();
		let release = () => {};
		const drain = new Promise<Result<null, never>>((resolve) => {
			release = () => resolve(ok(null));
		});
		const prepare = vi.fn<RunQuiesceAdapter["prepare"]>(() => drain);
		t.quiesce(prepare);
		t.attest();
		let settled = false;
		const admission = t.admit().then((result) => {
			settled = true;
			return result;
		});
		await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
		t.signal.abort();
		expect(settled).toBe(false);
		release();
		expect(await admission).toEqual(refused("aborted", true));
	});

	it("keeps malformed or thrown gate failures off the wire", async () => {
		const t = await setup();
		t.engine();
		const gate = t.quiesce(async () => {
			throw new Error("secret sentinel");
		});
		t.attest();
		expect(await t.admit()).toEqual(refused("unavailable"));
		gate.dispose();
		t.quiesce(
			async () =>
				ok("not drained") as Awaited<ReturnType<RunQuiesceAdapter["prepare"]>>,
		);
		t.attest();
		expect(await t.admit()).toEqual(refused("unavailable", true));
	});

	it.each([
		"gate",
		"engine",
		"gate-impl",
		"engine-impl",
		"native-pair",
		"recheck-throw",
	] as const)(
		"refuses a replaced %s authority after drain while retaining admission",
		async (target) => {
			const t = await setup();
			const engine = t.engine();
			let release = () => {};
			const wait = new Promise<Result<null, never>>((resolve) => {
				release = () => resolve(ok(null));
			});
			const prepare = vi.fn<RunQuiesceAdapter["prepare"]>(() => wait);
			const gate = t.quiesce(prepare);
			t.attest();
			const pending = t.admit();
			await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
			const interference = {
				gate: () => {
					gate.dispose();
					t.quiesce(prepare);
				},
				engine: () => {
					engine.dispose();
					t.engine();
				},
				"recheck-throw": () =>
					vi.spyOn(t.registry, "resolve").mockImplementation(() => {
						throw new Error("secret sentinel");
					}),
				"gate-impl": () =>
					replaceImplementation(t, "run.quiesce@1", { prepare }),
				"engine-impl": () => replaceImplementation(t, "team.engine@3", {}),
				"native-pair": () =>
					t.controls.onNativeControls({
						engine: fakeEngine(),
						quiesce: { prepare },
					}),
			};
			interference[target]();
			release();
			expect(await pending).toEqual(refused("unavailable", true));
		},
	);
});
