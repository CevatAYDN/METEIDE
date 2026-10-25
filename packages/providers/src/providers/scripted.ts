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

// A provider whose calls answer from a file, for the desktop's end-to-end tests (docs/15, ADR-111):
// `METE_SCRIPTED_CHAT` names a JSON array of chunk arrays, one per model call, the last repeating.
// The composition root uses it instead of every real provider, so a test run needs no key and no
// network, and the same script always answers the same way.

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

/** The script file: one turn of chunks per model call; the last one repeats. */
export const ScriptSchema = z.array(TurnSchema.min(1)).min(1);

/** A validated script. */
export type Script = z.infer<typeof ScriptSchema>;

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
const read = (file: string): Result<Script, string> => {
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
	const parsed = ScriptSchema.safeParse(json);
	return parsed.success ? ok(parsed.data) : err(issueList(parsed.error.issues));
};

// The provider's calls: one turn per call in order, the last turn repeating. The quota pool refuses
// a provider it does not know, so the module declares one generous unit and a scripted run never
// pauses for quota.
const adapterOf = (script: Script): ProviderAdapter => {
	let calls = 0;
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
			const turn = script[Math.min(calls++, script.length - 1)] ?? [];
			for (const chunk of turn) yield chunk;
		},
		quotaUnits: () => [
			{
				providerId: PROVIDER_ID,
				unit: "requests_per_minute",
				limit: 10_000,
				scope: "account",
				reset: "sliding",
			},
		],
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
