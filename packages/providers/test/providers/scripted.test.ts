import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatChunk, ProviderAdapter } from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { afterEach, describe, expect, it } from "vitest";
import { createScriptedModule } from "../../src/providers/scripted.js";

// The scripted provider of the desktop's end-to-end tests (docs/15; ADR-111): its calls answer from
// a file, one turn each in order, the last repeating; no key and no network. The file may also
// narrow the provider's quota unit, so a flow can pause for quota (ADR-113).

const say = (text: string): ChatChunk[] => [
	{ type: "text", text },
	{ type: "finish", reason: "stop", usage: { prompt: 3, completion: 2 } },
];

let dir: string | undefined;
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = undefined;
});

const fileWith = async (value: unknown) => {
	dir = await mkdtemp(join(tmpdir(), "mete-scripted-"));
	const file = join(dir, "chat.json");
	await writeFile(
		file,
		typeof value === "string" ? value : JSON.stringify(value),
	);
	return file;
};

const setup = () => {
	const registry = createCapabilityRegistry(() => []);
	const log = () => {};
	const ctx: ModuleContext = {
		capabilities: registry,
		events: createEventBus((e) => {
			throw e;
		}),
		config: createConfigReader({
			global: { file: "settings.yaml", sections: {} },
			workspace: {},
		}),
		logger: { error: log, warn: log, info: log, debug: log },
		disposables: { add: () => {}, dispose: () => {} },
	};
	return { ctx, registry };
};

const adapterOf = (s: ReturnType<typeof setup>) => {
	const r = s.registry.resolve<ProviderAdapter>("provider.chat@2");
	return r.ok ? r.value[0]?.impl : undefined;
};

const reply = async (
	adapter: ProviderAdapter,
	signal = new AbortController().signal,
) => {
	const chunks: ChatChunk[] = [];
	for await (const c of adapter.chat(
		{ model: "scripted-1", messages: [{ role: "user", content: "go" }] },
		signal,
	))
		chunks.push(c);
	return chunks.map((c) => (c.type === "text" ? c.text : c.type)).join("");
};

describe("the scripted provider", () => {
	it("answers one turn per call, the last repeating, and offers its model", async () => {
		const file = await fileWith([say("one"), say("two")]);
		const s = setup();
		const module = createScriptedModule(file);
		expect(await module.activate(s.ctx)).toEqual({
			ok: true,
			value: undefined,
		});
		const adapter = adapterOf(s);
		if (!adapter) throw new Error("no adapter");
		const models = await adapter.listModels(new AbortController().signal);
		expect(models.ok && models.value).toEqual([
			{
				id: "scripted-1",
				providerId: "scripted",
				family: "scripted",
				contextWindow: 64_000,
				toolCalling: true,
				vision: false,
				free: true,
				deprecated: false,
			},
		]);
		expect([
			await reply(adapter),
			await reply(adapter),
			await reply(adapter),
		]).toEqual(["onefinish", "twofinish", "twofinish"]);
		// The quota pool refuses a provider without a unit, so one generous unit is defined.
		expect(adapter.quotaUnits()).toEqual([
			{
				providerId: "scripted",
				unit: "requests_per_minute",
				limit: 10_000,
				scope: "account",
				reset: "sliding",
			},
		]);
		await module.deactivate();
		expect(adapterOf(s)).toBeUndefined();
	});

	it("takes the quota a script names, with the reset that makes a pause", async () => {
		const file = await fileWith({
			turns: [say("one")],
			quota: { limit: 1, reset: "fixed_daily" },
		});
		const s = setup();
		await createScriptedModule(file).activate(s.ctx);
		const adapter = adapterOf(s);
		if (!adapter) throw new Error("no adapter");
		expect(adapter.quotaUnits()).toEqual([
			{
				providerId: "scripted",
				unit: "requests_per_minute",
				limit: 1,
				scope: "account",
				reset: "fixed_daily",
			},
		]);
	});

	it("keeps the unit's other facts when a script names only its limit", async () => {
		const file = await fileWith({ turns: [say("one")], quota: { limit: 3 } });
		const s = setup();
		await createScriptedModule(file).activate(s.ctx);
		const adapter = adapterOf(s);
		if (!adapter) throw new Error("no adapter");
		expect(adapter.quotaUnits()).toEqual([
			{
				providerId: "scripted",
				unit: "requests_per_minute",
				limit: 3,
				scope: "account",
				reset: "sliding",
			},
		]);
	});

	it("fails activation on a quota limit that is not positive", async () => {
		const file = await fileWith({ turns: [say("one")], quota: { limit: 0 } });
		const r = await createScriptedModule(file).activate(setup().ctx);
		expect(!r.ok && r.error.code).toBe("activation_failed");
		expect(!r.ok && r.error.message).toContain("quota.limit");
	});

	it("answers an aborted call with one error chunk", async () => {
		const file = await fileWith([say("never sent")]);
		const s = setup();
		await createScriptedModule(file).activate(s.ctx);
		const adapter = adapterOf(s);
		if (!adapter) throw new Error("no adapter");
		const gone = new AbortController();
		gone.abort();
		expect(await reply(adapter, gone.signal)).toBe("error");
	});

	it("fails activation naming the file and the first problem", async () => {
		const file = await fileWith([{ type: "text", text: "not a turn" }]);
		const s = setup();
		const r = await createScriptedModule(file).activate(s.ctx);
		expect(!r.ok && r.error.code).toBe("activation_failed");
		expect(!r.ok && r.error.message).toContain(file);
		expect(adapterOf(s)).toBeUndefined();
	});

	it("fails activation on a file that is not JSON", async () => {
		const file = await fileWith("{");
		const r = await createScriptedModule(file).activate(setup().ctx);
		expect(!r.ok && r.error.message).toContain(file);
	});
});
