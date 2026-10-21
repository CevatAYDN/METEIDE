import { randomUUID } from "node:crypto";
import type {
	CapabilityRef,
	LlmChatAdapter,
	LlmChatRequest,
	LlmChunk,
	MeteEvent,
	Result,
	ToolContext,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
} from "@mete/kernel";
import Database from "better-sqlite3";
import { createEngine } from "../../src/application/engine.js";
import {
	createRunStore,
	RUN_MIGRATIONS,
	type RunStore,
} from "../../src/infrastructure/run-store.js";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";

// A real registry, bus and database around scripted fake adapters, with a manual clock.

/** One model reply as chunks; a function gets the request and the call's signal. */
export type Script =
	| readonly LlmChunk[]
	| ((req: LlmChatRequest, signal: AbortSignal) => AsyncIterable<LlmChunk>);

export const T0 = Date.parse("2026-10-21T10:00:00.000Z");

/** A logger that keeps what was logged. */
const recordingLogger = () => {
	const logged: { level: string; msg: string }[] = [];
	const at =
		(level: string) =>
		(_fields: Readonly<Record<string, unknown>>, msg: string) =>
			logged.push({ level, msg });
	return {
		logged,
		logger: {
			error: at("error"),
			warn: at("warn"),
			info: at("info"),
			debug() {},
		},
	};
};

/** A reply with text and the given tool calls. */
export const reply = (
	text: string,
	calls: { name: string; args: unknown }[] = [],
	model = "m1",
): LlmChunk[] => [
	{ type: "model", providerId: "p", modelId: model, reason: "first" },
	...(text ? [{ type: "text" as const, text }] : []),
	...calls.map((c, i) => ({
		type: "tool-call" as const,
		id: `call-${i}-${c.name}`,
		...c,
	})),
	{
		type: "finish",
		reason: calls.length > 0 ? "tool-calls" : "stop",
		usage: { prompt: 1, completion: 1 },
	},
];

/** A call that waits until it is aborted. */
export const slow = async function* (
	_req: LlmChatRequest,
	signal: AbortSignal,
): AsyncGenerator<LlmChunk> {
	await new Promise((resolve) => signal.addEventListener("abort", resolve));
	yield { type: "error", error: { code: "aborted", message: "aborted" } };
};

/** A fake tool adapter's run. */
export type Tool = (
	input: unknown,
	ctx: ToolContext,
) => Promise<Result<unknown, { code: string; message: string }>>;

const migrated = () => {
	const db = new Database(":memory:");
	for (const m of RUN_MIGRATIONS) db.exec(m.sql);
	return db;
};

/** Builds an engine; `scripts` answer model calls in order, the last one repeats. */
export const engineHarness = (opts: {
	scripts: Script[];
	tools?: ReadonlyArray<readonly [CapabilityRef, Tool]>;
	policy?: unknown;
	llm?: boolean;
	/** A database an earlier engine used, as after a restart. */
	db?: Database.Database;
	/** Changes the store, for example to make a write fail. */
	wrapStore?: (store: RunStore) => RunStore;
	templates?: TemplateDirs;
}) => {
	const registry = createCapabilityRegistry(() => []);
	const events: MeteEvent[] = [];
	const bus = createEventBus((e) => {
		throw e;
	});
	for (const p of [
		"run.*",
		"agent.*",
		"checkpoint.*",
		"task.*",
		"approval.*",
	] as const)
		bus.subscribe(p, (e) => events.push(e));
	const requests: LlmChatRequest[] = [];
	let n = 0;
	const chat: LlmChatAdapter["chat"] = (req, signal) => {
		requests.push(req);
		const s = opts.scripts[Math.min(n++, opts.scripts.length - 1)] ?? [];
		if (typeof s === "function") return s(req, signal);
		return (async function* () {
			yield* s;
		})();
	};
	if (opts.llm !== false)
		registry.provide<LlmChatAdapter>("llm.chat@1", {
			id: "gateway",
			trust: "core",
			features: [],
			impl: { chat },
		});
	for (const [ref, run] of opts.tools ?? [])
		registry.provide(ref, {
			id: `fake-${ref}`,
			trust: "core",
			features: [],
			impl: { run },
		});
	const db = opts.db ?? migrated();
	const clock = { now: T0 };
	const timers: { fn: () => void; ms: number }[] = [];
	const config = createConfigReader({
		global: { file: "settings.yaml", sections: {} },
		workspace: opts.policy
			? { policy: { file: ".mete/policy.yaml", value: opts.policy } }
			: {},
	});
	const { logged, logger } = recordingLogger();
	const plain = createRunStore(db);
	const store = opts.wrapStore ? opts.wrapStore(plain) : plain;
	const created = createEngine({
		workspaceId: randomUUID(),
		registry,
		events: bus,
		config,
		logger,
		store,
		now: () => clock.now,
		newId: randomUUID,
		setTimer: (fn, ms) => {
			const t = { fn, ms };
			timers.push(t);
			return () => {
				const i = timers.indexOf(t);
				if (i >= 0) timers.splice(i, 1);
			};
		},
		os: "TestOS 1",
		platform: "linux",
		templates: opts.templates,
	});
	return {
		...created,
		events,
		requests,
		db,
		store,
		clock,
		timers,
		registry,
		logged,
	};
};

/** Types of the events published so far. */
export const typesOf = (events: readonly MeteEvent[]) =>
	events.map((e) => e.type);
