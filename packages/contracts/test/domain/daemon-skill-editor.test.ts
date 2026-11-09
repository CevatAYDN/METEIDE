import { expect, it } from "vitest";
import {
	DaemonSkillsEditorParamsSchema,
	DaemonSkillsEditorResultSchema,
} from "../../src/domain/daemon-skill-editor.js";

const sessionId = "11111111-1111-4111-8111-111111111111";
const source = {
	sourceId: "a".repeat(64),
	scope: "workspace",
	path: "secret/SKILL.md",
};
const input = { sessionId, sourceId: source.sourceId };
const output = { ok: true, value: { sessionId, source } };

it("accepts only a session-bound opaque identity and a native relative source result", () => {
	expect(DaemonSkillsEditorParamsSchema.parse(input)).toEqual(input);
	expect(DaemonSkillsEditorResultSchema.parse(output)).toEqual(output);
	expect(
		DaemonSkillsEditorResultSchema.parse({
			ok: false,
			error: { code: "stale" },
		}),
	).toEqual({
		ok: false,
		error: { code: "stale" },
	});
});

it("rejects caller paths, bodies, roots, grants and malformed session/source identities", () => {
	for (const field of [
		"path",
		"uri",
		"text",
		"body",
		"root",
		"grant",
		"approved",
	]) {
		expect(
			DaemonSkillsEditorParamsSchema.safeParse({
				...input,
				[field]: "injected",
			}).success,
		).toBe(false);
		expect(
			DaemonSkillsEditorResultSchema.safeParse({
				ok: true,
				value: { ...output.value, [field]: "injected" },
			}).success,
		).toBe(false);
	}
	for (const patch of [
		{ sessionId: "bad" },
		{ sourceId: "bad" },
		{ sessionId: undefined },
	])
		expect(
			DaemonSkillsEditorParamsSchema.safeParse({ ...input, ...patch }).success,
		).toBe(false);
	for (const path of [
		"../SKILL.md",
		"/outside/SKILL.md",
		"sub/child/SKILL.md",
		"file:///outside",
	])
		expect(
			DaemonSkillsEditorResultSchema.safeParse({
				ok: true,
				value: { sessionId, source: { ...source, path } },
			}).success,
		).toBe(false);
});
