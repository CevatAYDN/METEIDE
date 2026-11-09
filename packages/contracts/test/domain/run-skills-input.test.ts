import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { RunStartSchema } from "../../src/domain/engine.js";
import {
	RunSkillPolicySchema,
	RunSkillRoleSchema,
	type RunSkillsStartInput,
	RunSkillsStartInputSchema,
} from "../../src/domain/run-skills-input.js";

const start: RunSkillsStartInput = {
	goal: "Review",
	templateId: "review-team",
};
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 7,
};
const role = { roleId: "reviewer", selected: [version] };
const auto = { mode: "auto", roles: [] };
const rejects = (schema: ZodType, input: unknown) =>
	expect(schema.safeParse(input).success).toBe(false);

describe("run.skills@1 start inputs", () => {
	it("creates independent default role arrays for every new start", () => {
		const first = RunSkillsStartInputSchema.parse(start);
		const second = RunSkillsStartInputSchema.parse(start);
		expect(first.skills.roles).not.toBe(second.skills.roles);
		first.skills.roles.push(role);
		expect(second.skills.roles).toEqual([]);
		expect(RunSkillsStartInputSchema.parse(start).skills.roles).toEqual([]);
	});

	it("defaults start, policy and role selections without explicit authority", () => {
		expect(RunSkillsStartInputSchema.parse(start)).toEqual({
			...start,
			priority: 1,
			skills: auto,
		});
		expect(
			RunSkillsStartInputSchema.parse({ ...start, skills: {} }).skills,
		).toEqual(auto);
		expect(RunSkillPolicySchema.parse({})).toEqual(auto);
		expect(RunSkillRoleSchema.parse({ roleId: "reviewer" })).toEqual({
			roleId: "reviewer",
			selected: [],
		});
	});

	it("retains manual, auto and off and refuses selections when off", () => {
		for (const mode of ["manual", "auto", "off"]) {
			const skills = {
				mode,
				roles: mode === "off" ? [{ ...role, selected: [] }] : [role],
			};
			expect(RunSkillPolicySchema.parse(skills)).toEqual(skills);
			expect(
				RunSkillsStartInputSchema.parse({ ...start, skills }).skills,
			).toEqual(skills);
		}
		rejects(RunSkillPolicySchema, { mode: "off", roles: [role] });
		rejects(RunSkillsStartInputSchema, {
			...start,
			skills: { mode: "off", roles: [role] },
		});
		rejects(RunSkillPolicySchema, { mode: "always" });
	});

	it("refuses duplicate roles and source identities despite changed versions", () => {
		for (const changed of [
			{ ...version, revision: 8 },
			{ ...version, sha256: "c".repeat(64) },
		]) {
			const duplicate = { ...role, selected: [version, changed] };
			rejects(RunSkillRoleSchema, duplicate);
			rejects(RunSkillPolicySchema, { roles: [duplicate] });
			rejects(RunSkillsStartInputSchema, {
				...start,
				skills: { roles: [duplicate] },
			});
		}
		const roles = [role, { ...role, selected: [] }];
		rejects(RunSkillPolicySchema, { roles });
		rejects(RunSkillsStartInputSchema, { ...start, skills: { roles } });
	});

	it("preserves exact ordered versions and permits the same source in distinct roles", () => {
		const other = {
			sourceId: "c".repeat(64),
			sha256: "d".repeat(64),
			revision: 11,
		};
		const roles = [
			{ ...role, selected: [other, version] },
			{ roleId: "writer", selected: [{ ...version, revision: 8 }] },
		];
		expect(RunSkillPolicySchema.parse({ roles })).toEqual({
			mode: "auto",
			roles,
		});
		expect(
			RunSkillsStartInputSchema.parse({ ...start, skills: { roles } }).skills
				.roles,
		).toEqual(roles);
	});

	it("bounds each role at four, allows two full roles and has no global role cap", () => {
		const selected = [1, 2, 3, 4, 5].map((n) => ({
			...version,
			sourceId: String(n).padStart(64, "0"),
		}));
		const full = { ...role, selected: selected.slice(0, 4) };
		expect(RunSkillRoleSchema.parse(full)).toEqual(full);
		const roles = [full, { ...full, roleId: "writer" }];
		expect(
			RunSkillsStartInputSchema.parse({ ...start, skills: { roles } }).skills
				.roles,
		).toEqual(roles);
		for (const schema of [RunSkillPolicySchema, RunSkillsStartInputSchema]) {
			const skills = { roles: [{ ...role, selected }] };
			rejects(
				schema,
				schema === RunSkillPolicySchema ? skills : { ...start, skills },
			);
		}
		rejects(RunSkillRoleSchema, { ...role, selected });
		const many = Array.from({ length: 129 }, (_, n) => ({
			roleId: `role_${n}`,
			selected: [],
		}));
		expect(RunSkillPolicySchema.parse({ roles: many }).roles).toEqual(many);
		expect(
			RunSkillsStartInputSchema.parse({ ...start, skills: { roles: many } })
				.skills.roles,
		).toEqual(many);
	});

	it("refuses explicit selections before routing but allows empty router policies", () => {
		for (const mode of ["manual", "auto", "off"]) {
			const input = {
				goal: "Review",
				skills: { mode, roles: [{ ...role, selected: [] }] },
			};
			expect(RunSkillsStartInputSchema.parse(input).skills).toEqual(
				input.skills,
			);
		}
		expect(RunSkillsStartInputSchema.parse({ goal: "Review" }).skills).toEqual(
			auto,
		);
		for (const mode of ["manual", "auto"])
			rejects(RunSkillsStartInputSchema, {
				goal: "Review",
				skills: { mode, roles: [role] },
			});
		rejects(RunSkillsStartInputSchema, {
			goal: "Review",
			skills: { roles: [{ roleId: "writer", selected: [] }, role] },
		});
	});

	it("allows only assistant with a null template and leaves loaded-team membership to core", () => {
		const assistant = { ...role, roleId: "assistant" };
		const input = {
			...start,
			templateId: null,
			skills: { roles: [assistant] },
		};
		expect(RunSkillsStartInputSchema.parse(input).skills.roles).toEqual([
			assistant,
		]);
		expect(
			RunSkillsStartInputSchema.parse({ ...start, templateId: null }).skills,
		).toEqual(auto);
		for (const selected of [[], [version]])
			rejects(RunSkillsStartInputSchema, {
				...start,
				templateId: null,
				skills: { roles: [{ ...role, selected }] },
			});
		const unknownRole = { ...role, roleId: "not_in_loaded_team" };
		expect(
			RunSkillsStartInputSchema.parse({
				...start,
				skills: { roles: [unknownRole] },
			}).skills.roles,
		).toEqual([unknownRole]);
	});

	it("preserves goal-or-continue, trimming, priority and single/per-role preferences", () => {
		const model = { providerId: "provider-a", modelId: "model-a" };
		for (const prefer of [model, { reviewer: model }]) {
			const input = { continue: true, priority: 2, prefer } as const;
			expect(RunSkillsStartInputSchema.parse(input)).toEqual({
				...input,
				skills: auto,
			});
		}
		expect(
			RunSkillsStartInputSchema.parse({ goal: " Review ", priority: 0 }),
		).toEqual({
			goal: "Review",
			priority: 0,
			skills: auto,
		});
		expect(
			RunSkillsStartInputSchema.parse({ goal: "Review", prefer: {} }).prefer,
		).toEqual({});
		rejects(RunSkillsStartInputSchema, {
			...start,
			prefer: { providerId: "provider-a" },
		});
		for (const input of [
			{},
			{ goal: " " },
			{ continue: false },
			{ goal: "Review", priority: 3 },
		])
			rejects(RunSkillsStartInputSchema, input);
	});

	it("rejects malformed roles, digests and revisions", () => {
		for (const roleId of ["", "Reviewer", "review-team", "../reviewer"])
			rejects(RunSkillRoleSchema, { ...role, roleId });
		for (const invalid of [
			{ ...version, sourceId: "bad" },
			{ ...version, sha256: "A".repeat(64) },
			{ ...version, revision: 0 },
			{ ...version, revision: 1.5 },
			{ ...version, revision: Number.MAX_SAFE_INTEGER + 1 },
		])
			rejects(RunSkillsStartInputSchema, {
				...start,
				skills: { roles: [{ ...role, selected: [invalid] }] },
			});
	});

	it("rejects content, owner, session and trust claims at every new boundary", () => {
		for (const extra of [
			{ body: "instructions" },
			{ text: "instructions" },
			{ owner: {} },
			{ trusted: true },
			{ sessionId: "session" },
			{ workspace: "/private" },
			{ origin: "model" },
		]) {
			rejects(RunSkillsStartInputSchema, { ...start, ...extra });
			rejects(RunSkillPolicySchema, { ...auto, ...extra });
			rejects(RunSkillRoleSchema, { ...role, ...extra });
			rejects(RunSkillRoleSchema, {
				...role,
				selected: [{ ...version, ...extra }],
			});
		}
	});

	it("leaves the legacy strict start schema and its behavior unchanged", () => {
		expect(RunStartSchema.parse({ goal: " Review " })).toEqual({
			goal: "Review",
			priority: 1,
		});
		expect(RunStartSchema.parse({ continue: true })).toEqual({
			continue: true,
			priority: 1,
		});
		rejects(RunStartSchema, {});
		rejects(RunStartSchema, { ...start, skills: auto });
	});
});
