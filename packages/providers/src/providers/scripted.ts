import { readFileSync } from "node:fs";
import {
	type ChatChunk,
	err,
	type ModelInfo,
	type ModuleManifest,
	ok,
	type ProviderAdapter,
	type Result,
} from "@mete/contracts";
import type { Disposable, MeteModule, ModuleError } from "@mete/kernel";
import { z } from "zod";
import { SCRIPTED_QUOTA } from "../defaults.js";

// A provider whose calls answer from a file, for the desktop's end-to-end tests (docs/15, ADR-111):
// `METE_SCRIPTED_CHAT` names a JSON array of chunk arrays, one per model call, the last repeating,
// or an object { turns, quota } that also narrows the provider's unit so a flow can pause for quota
// (ADR-113). The composition root uses it instead of every real provider, so a test run needs no key
// and no network, and the same script always answers the same way.

const text = z.string().min(1);

const TurnSchema = z.array(
	z.discriminatedUnion("type", [
		z.strictObject({ type: z.literal("text"), text }),
		z.strictObject({
			type: z.literal("tool-call"),
			id: text,
			name: text,
			args: z.unknown(),
		}),
		z.strictObject({
			type: z.literal("finish"),
			reason: z.enum([
				"stop",
				"length",
				"tool-calls",
				"content-filter",
				"other",
			]),
			usage: z.strictObject({
				prompt: z.number().int().nonnegative(),
				completion: z.number().int().nonnegative(),
			}),
		}),
	]),
);

/** A script's turns: one turn of chunks per model call; the last one repeats. */
export const ScriptSchema = z.array(TurnSchema.min(1)).min(1);

/** A validated script's turns. */
export type Script = z.infer<typeof ScriptSchema>;

// The scripted provider's unit, narrowed by a script that tests the quota pool (docs/15; ADR-113).
const QuotaOverrideSchema = z.strictObject({
	limit: z.number().positive().optional(),
	reset: z.enum(["sliding", "fixed_daily", "fixed_monthly"]).optional(),
});

/** The file: the turns alone (ADR-111), or the turns with the unit's limit and reset (ADR-113). */
export const ScriptFileSchema = z.union([
	ScriptSchema,
	z.strictObject({
		turns: ScriptSchema,
		quota: QuotaOverrideSchema.optional(),
	}),
]);

/** What a parsed file holds: its turns and, when the file names it, its quota override. */
export type ScriptFile = {
	readonly turns: Script;
	readonly quota?: z.infer<typeof QuotaOverrideSchema> | undefined;
};

const MANIFEST: ModuleManifest = {
	id: "provider-scripted",
	version: "0.0.0",
	displayName: "Scripted chat",
	class: "optional",
	trust: "first-party",
	provides: ["provider.chat@2"],
	requires: [],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
};

const PROVIDER_ID = "scripted";

// One free model with every fact the gateway needs to offer it for any tier.
const MODEL: ModelInfo = {
	id: "scripted-1",
	providerId: PROVIDER_ID,
	family: "scripted",
	contextWindow: 64_000,
	toolCalling: true,
	vision: false,
	free: true,
	deprecated: false,
};

const failed = (why: string): ModuleError => ({
	code: "activation_failed",
	moduleId: MANIFEST.id,
	message: why,
});

const issueList = (
	issues: readonly { path: PropertyKey[]; message: string }[],
) => issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

// The file is an external input, so it is parsed and checked before a call can reach it.
const read = (file: string): Result<ScriptFile, string> => {
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
	const parsed = ScriptFileSchema.safeParse(json);
	if (!parsed.success) return err(issueList(parsed.error.issues));
	return ok(Array.isArray(parsed.data) ? { turns: parsed.data } : parsed.data);
};

// The provider's calls: one turn per call in order, the last turn repeating. The quota pool refuses
// a provider it does not know, so the module defines one generous unit and a scripted run never
// pauses for quota unless the script narrows it (ADR-113).
const adapterOf = (file: ScriptFile): ProviderAdapter => {
	let calls = 0;
	const unit = {
		...SCRIPTED_QUOTA,
		providerId: PROVIDER_ID,
		...(file.quota?.limit === undefined ? {} : { limit: file.quota.limit }),
		...(file.quota?.reset === undefined ? {} : { reset: file.quota.reset }),
	};
	return {
		id: PROVIDER_ID,
		format: "openai-chat",
		listModels: async () => ok([MODEL]),
		async *chat(_req, signal) {
			if (signal.aborted) {
				yield {
					type: "error",
					error: { code: "aborted", message: "aborted" },
				} satisfies ChatChunk;
				return;
			}
			const turn = file.turns[Math.min(calls++, file.turns.length - 1)] ?? [];
			for (const chunk of turn) yield chunk;
		},
		quotaUnits: () => [unit],
		observe: () => [],
		privacy: () => ({ trains: false, logs: false, publishes: false }),
	};
};

/** Creates the scripted-chat module for the desktop's end-to-end tests (docs/15; ADR-111). */
export const createScriptedModule = (file: string): MeteModule => {
	let created: Disposable[] = [];
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			const script = read(file);
			if (!script.ok) {
				// The UI names the module and its code; the log keeps the file and the reason.
				ctx.logger.warn({ file }, `scripted chat not loaded: ${script.error}`);
				return err(failed(`${file}: ${script.error}`));
			}
			created = [
				ctx.capabilities.provide("provider.chat@2", {
					id: PROVIDER_ID,
					trust: MANIFEST.trust,
					features: [],
					impl: adapterOf(script.value),
				}),
			];
			for (const d of created) ctx.disposables.add(d);
			return ok(undefined);
		},
		async deactivate() {
			for (const d of created.splice(0)) d.dispose();
		},
	};
};
