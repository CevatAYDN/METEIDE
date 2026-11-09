import { PolicyActionSchema, PolicySchema } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	POLICY_RULE_KEYS,
	type PolicyRuleKey,
	readPolicyRule,
} from "../src/application/policy-rule-fields.js";

describe("policy rule field drafts (ADR-192)", () => {
	it("lists only the five existing rule fields in display order", () => {
		expect(POLICY_RULE_KEYS).toEqual([
			"always_ask",
			"never_allow",
			"shell.allow",
			"shell.always",
			"overrides",
		]);
	});

	it("keeps undefined inherited and explicit empty containers explicit", () => {
		for (const key of POLICY_RULE_KEYS) {
			expect(readPolicyRule(key, undefined)).toEqual({
				ok: true,
				value: undefined,
			});
			const empty = key === "overrides" ? {} : [];
			expect(readPolicyRule(key, empty)).toEqual({ ok: true, value: empty });
			expect(readPolicyRule(key, null).ok).toBe(false);
			expect(readPolicyRule(key, [undefined]).ok).toBe(false);
		}
	});

	it("accepts the public action vocabulary without deduplication", () => {
		const actions = [...PolicyActionSchema.options, "git.push"];
		expect(readPolicyRule("always_ask", actions)).toEqual({
			ok: true,
			value: actions,
		});
		for (const bad of [
			["fs.read"],
			["git.push@1"],
			["git.push", 1],
			"git.push",
		])
			expect(readPolicyRule("always_ask", bad).ok).toBe(false);
	});

	it("accepts exactly the filesystem-path and shell-command deny variants", () => {
		const rules = [
			{ action: "fs.write", path: "~/.ssh/**" },
			{ action: "fs.delete", path: "private/**" },
			{ action: "fs.write.outside", path: "/outside/**" },
			{ action: "shell.exec", command: "*Stop-Process*" },
		];
		expect(readPolicyRule("never_allow", rules)).toEqual({
			ok: true,
			value: rules,
		});
		expect(PolicySchema.parse({ never_allow: rules }).never_allow).toEqual(
			rules,
		);
		for (const bad of [
			{ action: "git.push", path: "**" },
			{ action: "fs.write", command: "echo x" },
			{ action: "shell.exec", path: "**" },
			{ action: "fs.write", path: "" },
			{ action: "shell.exec", command: "" },
			{ action: "fs.write" },
			{ action: "shell.exec", command: "echo x", extra: true },
			{ action: "fs.write", path: "**", command: "echo x" },
			null,
		])
			expect(readPolicyRule("never_allow", [rules[0], bad]).ok).toBe(false);
	});

	it("preserves shell text, patterns, order and duplicates without evaluating them", () => {
		const commands = [" git diff * ", "echo x && echo y", "git diff *", " "];
		for (const key of ["shell.allow", "shell.always"] as const) {
			expect(readPolicyRule(key, commands)).toEqual({
				ok: true,
				value: commands,
			});
			for (const bad of [[""], ["git status", false], {}, "git status"])
				expect(readPolicyRule(key, bad).ok).toBe(false);
		}
	});

	it("validates capability refs and every integer level independently of autonomy", () => {
		const overrides = {
			"shell.exec@1": 3,
			"fs.write@1": 0,
			"media.3d.fromText@2": 1,
			"3d.cleanup@12": 2,
		};
		expect(readPolicyRule("overrides", overrides)).toEqual({
			ok: true,
			value: overrides,
		});
		expect(PolicySchema.parse({ autonomy: 3, overrides }).overrides).toEqual(
			overrides,
		);
		expect(PolicySchema.safeParse({ autonomy: 2, overrides }).success).toBe(
			false,
		);
		for (const bad of [
			{ "shell.exec": 1 },
			{ "shell.exec@0": 1 },
			{ " shell.exec@1": 1 },
			{ "shell.exec@1": 4 },
			{ "shell.exec@1": -1 },
			{ "shell.exec@1": 1.5 },
			{ "shell.exec@1": "1" },
			{ "shell.exec@1": undefined },
			{ "shell.exec@1": Number.NaN },
			{ "shell.exec@1": Number.POSITIVE_INFINITY },
			[],
		])
			expect(readPolicyRule("overrides", bad).ok).toBe(false);
	});

	it("refuses prototype-sensitive own keys instead of silently dropping them", () => {
		for (const key of ["__proto__", "constructor", "prototype"]) {
			const overrides = { "shell.exec@1": 1, [key]: 1 };
			expect(readPolicyRule("overrides", overrides).ok).toBe(false);
			const rule = { action: "fs.write", path: "**", [key]: {} };
			expect(readPolicyRule("never_allow", [rule]).ok).toBe(false);
		}
	});

	it("refuses hidden, symbol, accessor and extra array entries before they can disappear", () => {
		const hidden = Object.defineProperty({}, "shell.exec@1", { value: 1 });
		const symbol = { "shell.exec@1": 1, [Symbol("hidden")]: 1 };
		const getter = Object.defineProperty({}, "shell.exec@1", {
			enumerable: true,
			get: () => {
				throw new Error("must not invoke external accessors");
			},
		});
		for (const bad of [hidden, symbol, getter])
			expect(readPolicyRule("overrides", bad).ok).toBe(false);
		const hiddenRule = Object.defineProperty(
			{ action: "fs.write", path: "**" },
			"extra",
			{ value: true },
		);
		expect(readPolicyRule("never_allow", [hiddenRule]).ok).toBe(false);
		const extra = Object.assign(["git.push"], { extra: "fs.delete" });
		expect(readPolicyRule("always_ask", extra).ok).toBe(false);
	});

	it("does not turn inherited entries or non-map objects into empty successful maps", () => {
		const inherited: unknown = Object.create({ "shell.exec@1": 1 });
		for (const bad of [inherited, new Map([["shell.exec@1", 1]]), new Date()])
			expect(readPolicyRule("overrides", bad).ok).toBe(false);
		const nullPrototype: unknown = Object.setPrototypeOf(
			{ "shell.exec@1": 1 },
			null,
		);
		expect(readPolicyRule("overrides", nullPrototype)).toEqual({
			ok: true,
			value: { "shell.exec@1": 1 },
		});
	});

	it("returns a field-local error and leaves caller-owned values untouched", () => {
		const values: readonly [PolicyRuleKey, unknown][] = [
			["always_ask", ["git.push", "not.an.action"]],
			["never_allow", [{ action: "shell.exec", command: 42 }]],
			["shell.allow", ["ok", ""]],
			["shell.always", ["ok", null]],
			["overrides", { "shell.exec@1": 5 }],
		];
		for (const [key, value] of values) {
			const before = JSON.stringify(value);
			const result = readPolicyRule(key, value);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.startsWith(key)).toBe(true);
			expect(JSON.stringify(value)).toBe(before);
		}
		const frozen = Object.freeze(["git.push"]);
		expect(readPolicyRule("always_ask", frozen)).toEqual({
			ok: true,
			value: ["git.push"],
		});
	});
});
