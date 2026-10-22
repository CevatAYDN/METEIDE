import { join } from "node:path";
import type { PolicyCheckAdapter, PolicyCheckInput } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for policy.check@1 (SECURITY.md, Policy file), under the built-in policy.

/** Opens an adapter with the built-in policy for the given workspace and home folders. */
export type PolicyCheckHarness = () => Promise<{
	readonly adapter: PolicyCheckAdapter;
	readonly workspaceDir: string;
	readonly home: string;
	readonly close: () => Promise<void>;
}>;

const write = (path: string): PolicyCheckInput => ({
	action: "fs.write",
	capability: "fs.write@1",
	adapterId: "kit",
	args: { path },
	path,
});

/** Every policy.check@1 adapter MUST pass these tests. */
export const policyCheckContract = (name: string, open: PolicyCheckHarness) =>
	describe(`policy.check@1 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const fresh = async () => {
			const h = await open();
			close = h.close;
			return h;
		};
		const verdict = (r: ReturnType<PolicyCheckAdapter["check"]>) =>
			r.ok ? r.value : r.error;

		it("allows a write inside the workspace and names the rule", async () => {
			const h = await fresh();
			expect(
				verdict(h.adapter.check(write(join(h.workspaceDir, "src", "a.ts")))),
			).toEqual({
				verdict: "allow",
				rule: "autonomy:2:inside",
			});
		});

		it("asks before a write to a package script manifest at level 2", async () => {
			const h = await fresh();
			expect(
				verdict(h.adapter.check(write(join(h.workspaceDir, "package.json")))),
			).toEqual({ verdict: "ask", rule: "autonomy:2:script_manifest" });
		});

		it("denies never_allow, protected paths and missing input", async () => {
			const h = await fresh();
			const deny = (input: PolicyCheckInput) => verdict(h.adapter.check(input));
			expect(
				deny(write(join(h.home, ".ssh", "authorized_keys"))),
			).toMatchObject({
				verdict: "deny",
				rule: "never_allow:0",
			});
			expect(
				deny(write(join(h.workspaceDir, ".mete", "policy.yaml"))),
			).toMatchObject({
				verdict: "deny",
				rule: "protected_path",
			});
			expect(
				deny({
					action: "shell.exec",
					capability: "shell.exec@1",
					adapterId: "kit",
					args: {},
				}),
			).toMatchObject({ verdict: "deny", rule: "missing_input" });
		});

		it("asks for always_ask actions and, under the built-in shell.exec@1 override, every command", async () => {
			const h = await fresh();
			const ask = (input: PolicyCheckInput) => verdict(h.adapter.check(input));
			expect(
				ask({
					action: "git.push",
					capability: "vcs.git@2",
					adapterId: "kit",
					args: {},
				}),
			).toEqual({
				verdict: "ask",
				rule: "always_ask",
			});
			expect(
				ask({
					action: "shell.exec",
					capability: "shell.exec@1",
					adapterId: "kit",
					args: {},
					command: "pnpm install",
				}),
			).toEqual({ verdict: "ask", rule: "autonomy:1" });
		});
	});
