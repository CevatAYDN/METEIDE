import { describe, expect, it } from "vitest";
import {
	parseTemplate,
	TeamTemplateV1Schema,
	TeamTemplateV2Schema,
} from "../../src/domain/template.js";

const template = (apiVersion: string, verify: readonly unknown[]) => ({
	apiVersion,
	kind: "TeamTemplate",
	metadata: { id: "checked", name: "Checked", version: "1.0.0" },
	pattern: "pipeline",
	roles: [
		{
			id: "worker",
			name: "Worker",
			goal: "Work",
			tier: "coder",
			capabilities: [],
		},
	],
	tasks: [{ id: "work", role: "worker", title: "Work", verify }],
	spawn_defaults: { worker: { verify } },
});

describe("versioned verification gates", () => {
	it("keeps the v1 parser and rejects new fields in legacy templates", () => {
		expect(
			TeamTemplateV1Schema.safeParse(template("mete/v1", [{ run: "check" }]))
				.success,
		).toBe(true);
		expect(
			TeamTemplateV1Schema.safeParse(
				template("mete/v1", [{ run: "check", optional: true }]),
			).success,
		).toBe(false);
		expect(
			parseTemplate(
				template("mete/v1", [
					{ capability: "gameengine.test@1", optional: true },
				]),
			).ok,
		).toBe(false);
	});

	it.each([undefined, false, true])(
		"accepts v2 command and capability optionality %s",
		(optional) => {
			const flag = optional === undefined ? {} : { optional };
			const input = template("mete/v2", [
				{ run: "check", ...flag },
				{ capability: "gameengine.test@1", args: {}, ...flag },
			]);
			const parsed = TeamTemplateV2Schema.parse(input);
			expect(parsed.tasks[0]?.verify?.[0]).toEqual({ run: "check", ...flag });
			expect(parsed.spawn_defaults?.worker?.verify).toEqual(
				parsed.tasks[0]?.verify,
			);
			expect(parseTemplate(input).ok).toBe(true);
		},
	);

	it("does not interpret or remove expect while parsing", () => {
		const gate = { capability: "gameengine.test@1", expect: { passed: true } };
		const parsed = parseTemplate(template("mete/v2", [gate]));
		expect(parsed.ok && parsed.value.tasks[0]?.verify?.[0]).toEqual(gate);
	});

	it("retains reference validation and refuses unknown flags and versions", () => {
		const invalid = {
			...template("mete/v2", [{ run: "check" }]),
			tasks: [{ id: "work", role: "missing", title: "Work" }],
		};
		expect(parseTemplate(invalid).ok).toBe(false);
		expect(
			parseTemplate(template("mete/v2", [{ run: "check", optional: "true" }]))
				.ok,
		).toBe(false);
		expect(
			parseTemplate(template("mete/v2", [{ run: "check", skip: true }])).ok,
		).toBe(false);
		expect(parseTemplate(template("mete/v3", [{ run: "check" }])).ok).toBe(
			false,
		);
	});
});
