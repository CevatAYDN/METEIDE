import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EventsReadAdapter, type MeteEvent, ok } from "@mete/contracts";
import {
	createCapabilityRegistry,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { afterAll, describe, expect, it } from "vitest";
import { createVaultModule } from "../src/module.js";

// The vault module's run reports (docs/11, Run reports; ADR-144) over a fake events.read@1 that
// answers what was published, as storage persists each event when it is published.

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

const WS = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-28T12:00:00.000Z");

const setup = async (read?: EventsReadAdapter["read"]) => {
	const root = await mkdtemp(join(tmpdir(), "mete-vault-"));
	roots.push(root);
	const registry = createCapabilityRegistry(() => []);
	const bus = createEventBus((e) => {
		throw e;
	});
	const stored: MeteEvent[] = [];
	const errors: string[] = [];
	const impl: EventsReadAdapter = {
		read:
			read ??
			((id) => ({ events: stored.filter((e) => e.runId === id), broken: [] })),
	};
	registry.provide("events.read@1", {
		id: "storage",
		trust: "core",
		features: [],
		impl,
	});
	const log = () => {};
	const items: { dispose: () => void }[] = [];
	const ctx: ModuleContext = {
		capabilities: registry,
		events: bus,
		config: { get: () => ok(undefined as never) },
		logger: {
			error: (_o, m) => errors.push(String(m)),
			warn: log,
			info: log,
			debug: log,
		},
		disposables: { add: (d) => items.push(d), dispose: () => {} },
	};
	const saved: MeteEvent[] = [];
	bus.subscribe("vault.*", (e) => saved.push(e));
	const publish = (e: MeteEvent) => {
		stored.push(e);
		bus.publish(e);
	};
	const mod = createVaultModule({
		workspaceDir: root,
		workspaceId: WS,
		now: () => NOW,
	});
	await mod.activate(ctx);
	const note = (day: string) =>
		readFile(join(root, ".mete", "knowledge", "journal", `${day}.md`), "utf8");
	return { mod, publish, saved, errors, note };
};

let n = 0;
const ev = <T extends MeteEvent["type"]>(
	runId: string,
	type: T,
	payload: Extract<MeteEvent, { type: T }>["payload"],
	ts = "2026-10-28T09:30:00.000Z",
) =>
	({
		id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
		ts,
		schema: 1,
		workspaceId: WS,
		runId,
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

const tick = () => new Promise((r) => setImmediate(r));
const day = (ts: string) => {
	const d = new Date(ts);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// The core publishes the handoff right after the ending event, in the same call (docs/08).
const finish = (
	s: Awaited<ReturnType<typeof setup>>,
	runId: string,
	goal: string,
) => {
	s.publish(ev(runId, "run.created", { templateId: null, goal }));
	s.publish(ev(runId, "run.completed", { summary: "Done." }));
	s.publish(
		ev(runId, "handoff.created", {
			handoffId: "22222222-2222-4222-8222-222222222222",
			files: ["index.html"],
		}),
	);
};

describe("vault module", () => {
	it("writes an ended run's report with the files of the handoff published after it", async () => {
		const s = await setup();
		finish(s, RUN_A, "Build a page");
		await tick();
		await s.mod.deactivate();
		const d = day("2026-10-28T09:30:00.000Z");
		const text = await s.note(d);
		expect(text).toMatch(
			new RegExp(
				`^---\\ntype: journal\\ntitle: Journal ${d}\\ncreated: 2026-10-28T12:00:00.000Z\\n`,
			),
		);
		expect(text).toContain(`source: run/${RUN_A}\n`);
		expect(text).toContain("## Build a page\n");
		expect(text).toContain("- Changed files: `index.html`\n");
		expect(s.saved.map((e) => [e.runId, e.source, e.payload])).toEqual([
			[
				RUN_A,
				"vault",
				{ path: `.mete/knowledge/journal/${d}.md`, noteType: "journal" },
			],
		]);
	});

	it("appends a later run to the day's note under one frontmatter", async () => {
		const s = await setup();
		finish(s, RUN_A, "First");
		await tick();
		finish(s, RUN_B, "Second");
		await s.mod.deactivate();
		const text = await s.note(day("2026-10-28T09:30:00.000Z"));
		expect(text.match(/^---$/gm)).toHaveLength(2);
		expect(text.indexOf("## First")).toBeLessThan(text.indexOf("## Second"));
		expect(s.saved).toHaveLength(2);
	});

	it("writes the report of a run that ends right before a stop", async () => {
		const s = await setup();
		finish(s, RUN_A, "Stopped soon");
		await s.mod.deactivate();
		expect(await s.note(day("2026-10-28T09:30:00.000Z"))).toContain(
			"## Stopped soon",
		);
	});

	it("logs a report whose events cannot be read and writes nothing", async () => {
		const s = await setup(() => {
			throw new Error("The database connection is not open");
		});
		finish(s, RUN_A, "Lost");
		await s.mod.deactivate();
		expect(s.errors).toEqual(["run report not written"]);
		expect(s.saved).toEqual([]);
		await expect(s.note(day("2026-10-28T09:30:00.000Z"))).rejects.toThrow();
	});

	it("leaves paused runs alone", async () => {
		const s = await setup();
		s.publish(ev(RUN_A, "run.paused", { reason: "user" }));
		await tick();
		await s.mod.deactivate();
		expect(s.saved).toEqual([]);
	});
});
