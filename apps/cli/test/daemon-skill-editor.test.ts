import { randomUUID } from "node:crypto";
import {
	DAEMON_METHODS,
	DaemonSkillsListResultSchema,
	err,
	ok,
	type SkillSourceAdapter,
	type SkillSourceInput,
} from "@mete/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { CancellationTokenSource } from "vscode-jsonrpc/node";
import { resolveSkillEditor } from "../src/application/daemon-skill-editor.js";
import { entry, skillProtocol, sourceId } from "./skill-protocol-fixture.js";

const source = { ...entry.source, path: "secret/SKILL.md" };
const snapshot = {
	source,
	text: "private body sentinel",
	sha256: "b".repeat(64),
};
const fixtures: ReturnType<typeof skillProtocol>[] = [];
afterEach(async () => {
	for (const fixture of fixtures.splice(0)) await fixture.close();
});
const setup = async (supported = true) => {
	const natives = new WeakSet<object>();
	const t = skillProtocol(
		false,
		supported
			? Object.freeze({ has: (impl: SkillSourceAdapter) => natives.has(impl) })
			: undefined,
	);
	fixtures.push(t);
	const read = vi.fn(
		async (_input: SkillSourceInput, _signal: AbortSignal): Promise<unknown> =>
			ok(snapshot),
	);
	const impl = { read, list: vi.fn() };
	natives.add(impl);
	const provide = (implementation = impl, id = "tools-skill-source") =>
		t.registry.provide("skill.source@1", {
			id,
			trust: "core",
			features: [],
			impl: implementation,
		});
	const registration = provide();
	t.status.mockResolvedValue(
		ok({
			entries: [{ ...entry, source: { ...source, path: "masked/SKILL.md" } }],
			complete: true,
			diagnostics: [],
		}),
	);
	const listed = DaemonSkillsListResultSchema.parse(
		await t.client.sendRequest(DAEMON_METHODS.skillsList, {}),
	);
	if (!listed.ok) throw new Error("Inventory fixture failed");
	return {
		...t,
		natives,
		read,
		impl,
		provide,
		registration,
		listed: listed.value,
	};
};
const request = (t: Awaited<ReturnType<typeof setup>>) =>
	t.client.sendRequest(DAEMON_METHODS.skillsEditor, {
		sessionId: t.listed.sessionId,
		sourceId,
	});
const deferred = () => {
	let resolve: (value: unknown) => void = () => {};
	const promise = new Promise<unknown>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

it("resolves the opaque original, not a valid masked sibling label, without other work", async () => {
	const t = await setup();
	expect(t.listed.entries[0]?.source).toEqual({
		...source,
		path: "masked/SKILL.md",
	});
	const resolve = vi.spyOn(t.registry, "resolve");
	expect(await request(t)).toEqual(
		ok({ sessionId: t.listed.sessionId, source }),
	);
	expect(t.read).toHaveBeenCalledExactlyOnceWith(
		{ sourceId },
		expect.any(AbortSignal),
	);
	expect(resolve.mock.calls.map(([ref]) => ref)).toEqual([
		"skill.source@1",
		"skill.source@1",
	]);
	expect(t.impl.list).not.toHaveBeenCalled();
	expect(t.status).toHaveBeenCalledOnce();
	expect(t.prepare).not.toHaveBeenCalled();
	expect(t.approve).not.toHaveBeenCalled();
	expect(t.disable).not.toHaveBeenCalled();
	expect(t.stop).not.toHaveBeenCalled();
});

it("refuses a wrong session and malformed inputs before any adapter resolution or read", async () => {
	const t = await setup();
	const resolve = vi.spyOn(t.registry, "resolve");
	expect(
		await t.client.sendRequest(DAEMON_METHODS.skillsEditor, {
			sessionId: randomUUID(),
			sourceId,
		}),
	).toEqual(err({ code: "stale" }));
	for (const input of [
		{ sourceId },
		{ sessionId: t.listed.sessionId, sourceId: "bad" },
		{ sessionId: t.listed.sessionId, sourceId, path: "masked/SKILL.md" },
	])
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsEditor, input),
		).toEqual(err({ code: "bad_input" }));
	expect(resolve).not.toHaveBeenCalled();
	expect(t.read).not.toHaveBeenCalled();
});

it.each(["absent", "missing", "foreign", "fallback"] as const)(
	"refuses %s native source support without trusting ids, labels or a fallback",
	async (mode) => {
		const t = await setup(mode !== "absent");
		if (mode !== "absent") t.registration.dispose();
		if (mode === "foreign" || mode === "fallback") t.provide({ ...t.impl });
		if (mode === "fallback") t.provide(t.impl, "native-fallback");
		expect(await request(t)).toEqual(err({ code: "unavailable" }));
		expect(t.read).not.toHaveBeenCalled();
	},
);

it.each([
	{ ok: true, value: snapshot, extra: "secret" },
	ok({ ...snapshot, text: 123 }),
	ok({ ...snapshot, sha256: "bad" }),
	ok({ ...snapshot, root: "/private/root" }),
	ok({ ...snapshot, source: { ...source, path: "../SKILL.md" } }),
	ok({ ...snapshot, source: { ...source, sourceId: "c".repeat(64) } }),
	{ ok: false, error: { code: "not_found", message: "/private/root" } },
	{ ok: false, error: { code: "unknown" } },
	null,
])(
	"rejects malformed or mismatched native snapshot %# without leaking it",
	async (raw) => {
		const t = await setup();
		t.read.mockResolvedValue(raw);
		expect(await request(t)).toEqual(err({ code: "unavailable" }));
	},
);

it("preserves safe refusals and sanitizes thrown read failures", async () => {
	const t = await setup();
	const refusal = err({ code: "not_found", sourceId, location: "source" });
	t.read.mockResolvedValueOnce(refusal);
	expect(await request(t)).toEqual(refusal);
	t.read.mockRejectedValueOnce(
		new Error("/private/root private body sentinel"),
	);
	expect(await request(t)).toEqual(err({ code: "unavailable" }));
});

it.each(["descriptor", "implementation"] as const)(
	"refuses a replaced %s even when its implementation is attested",
	async (target) => {
		const t = await setup();
		const wait = deferred();
		t.read.mockReturnValueOnce(wait.promise);
		const pending = request(t);
		await vi.waitFor(() => expect(t.read).toHaveBeenCalledOnce());
		if (target === "descriptor") {
			t.registration.dispose();
			t.provide(t.impl);
		} else {
			const replacement = { ...t.impl };
			t.natives.add(replacement);
			const current = t.registry.resolve("skill.source@1");
			if (!current.ok) throw new Error("Source fixture missing");
			Object.defineProperty(current.value[0], "impl", { value: replacement });
		}
		wait.resolve(ok(snapshot));
		expect(await pending).toEqual(err({ code: "unavailable" }));
	},
);

it("bridges cancellation through the read and never returns its late source", async () => {
	const t = await setup();
	const wait = deferred();
	t.read.mockReturnValueOnce(wait.promise);
	const cancellation = new CancellationTokenSource();
	try {
		const pending = t.client.sendRequest(
			DAEMON_METHODS.skillsEditor,
			{ sessionId: t.listed.sessionId, sourceId },
			cancellation.token,
		);
		await vi.waitFor(() => expect(t.read).toHaveBeenCalledOnce());
		cancellation.cancel();
		await vi.waitFor(() =>
			expect(t.read.mock.calls[0]?.[1].aborted).toBe(true),
		);
		wait.resolve(ok(snapshot));
		expect(await pending).toEqual(err({ code: "aborted" }));
	} finally {
		cancellation.dispose();
	}
});

it("refuses pre-cancelled work before resolving an adapter", async () => {
	const t = await setup();
	const resolve = vi.spyOn(t.registry, "resolve");
	const controller = new AbortController();
	controller.abort();
	const app = {
		registry: t.registry,
		skillTrustAdapters: { has: () => false },
	};
	expect(
		await resolveSkillEditor(
			app,
			t.listed.sessionId,
			{ sessionId: t.listed.sessionId, sourceId },
			controller.signal,
		),
	).toEqual(err({ code: "aborted" }));
	expect(resolve).not.toHaveBeenCalled();
	expect(t.read).not.toHaveBeenCalled();
});
