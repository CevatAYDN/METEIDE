import type {
	PolicyAsk,
	PolicyCheckAdapter,
	PolicyCheckInput,
	PolicyGrantAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for policy.grant@1 (SECURITY.md, Answering an ask; ADR-121), under the built-in
// policy, whose shell.exec@1 override asks for every command.

/** Opens the grant adapter and the policy.check@1 adapter whose asks it answers. */
export type PolicyGrantHarness = () => Promise<{
	readonly grant: PolicyGrantAdapter;
	readonly check: PolicyCheckAdapter;
	readonly close: () => Promise<void>;
}>;

const shell = (
	runId: string,
	command: string,
	tainted = false,
): PolicyCheckInput => ({
	action: "shell.exec",
	capability: "shell.exec@1",
	adapterId: "kit",
	args: { command },
	runId,
	command,
	tainted,
});

const askOf = (command: string): PolicyAsk => ({
	action: "shell.exec",
	capability: "shell.exec@1",
	adapterId: "kit",
	command,
});

/** Every policy.grant@1 adapter MUST pass these tests. */
export const policyGrantContract = (name: string, open: PolicyGrantHarness) =>
	describe(`policy.grant@1 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const fresh = async () => {
			const h = await open();
			close = h.close;
			const rule = (input: PolicyCheckInput) => {
				const r = h.check.check(input);
				return r.ok ? `${r.value.verdict} ${r.value.rule}` : r.error.code;
			};
			return { ...h, rule };
		};
		const runId = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";

		it("lets the granted call through once, then asks again", async () => {
			const h = await fresh();
			expect(h.rule(shell(runId, "npm install"))).toBe("ask autonomy:1");
			h.grant.grant({ runId, scope: "once", ask: askOf("npm install") });
			expect(h.rule(shell(runId, "npm install"))).toBe("allow granted:once");
			expect(h.rule(shell(runId, "npm install"))).toBe("ask autonomy:1");
		});

		it("lets a once grant through a tainted step, since the user saw that very call", async () => {
			const h = await fresh();
			h.grant.grant({ runId, scope: "once", ask: askOf("npm install") });
			expect(h.rule(shell(runId, "npm install", true))).toBe(
				"allow granted:once",
			);
		});

		it("lets a run grant through for the rest of the run, but not on a tainted step or in another run", async () => {
			const h = await fresh();
			h.grant.grant({ runId, scope: "run", ask: askOf("npm install") });
			expect(h.rule(shell(runId, "npm install"))).toBe("allow granted:run");
			expect(h.rule(shell(runId, "npm install"))).toBe("allow granted:run");
			expect(h.rule(shell(runId, "npm install", true))).toBe("ask autonomy:1");
			const other = "0e1d2c3b-4a59-4687-8796-a5b4c3d2e1f0";
			expect(h.rule(shell(other, "npm install"))).toBe("ask autonomy:1");
		});

		it("covers only the command it was given", async () => {
			const h = await fresh();
			h.grant.grant({ runId, scope: "run", ask: askOf("npm install") });
			expect(h.rule(shell(runId, "npm install lodash"))).toBe("ask autonomy:1");
		});

		it("never turns a deny into allow", async () => {
			const h = await fresh();
			h.grant.grant({ runId, scope: "run", ask: askOf("rm -rf /*") });
			expect(h.rule(shell(runId, "rm -rf /*"))).toBe("deny never_allow:1");
		});
	});
