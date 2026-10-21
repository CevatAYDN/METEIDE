import type {
	PolicyVerdict,
	ShellExecInput,
	ShellExecOutput,
	ToolAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for shell.exec@1 (docs/06 tool types, docs/10 Built-in tools).
// Commands call `node -e` so they read the same in PowerShell and /bin/sh.

/** Opens the adapter on an empty workspace whose policy.check@1 always answers `verdict`. */
export type ShellExecHarness = (verdict: PolicyVerdict["verdict"]) => Promise<{
	readonly adapter: ToolAdapter<ShellExecInput, ShellExecOutput>;
	readonly close: () => Promise<void>;
}>;

const ctx = { signal: new AbortController().signal };
const node = (script: string) => `node -e "${script}"`;

/** Every shell.exec@1 adapter MUST pass these tests. */
export const shellExecContract = (name: string, open: ShellExecHarness) =>
	describe(`shell.exec@1 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const exec = async (
			input: ShellExecInput,
			verdict: PolicyVerdict["verdict"] = "allow",
		) => {
			const h = await open(verdict);
			close = h.close;
			return h.adapter.run(input, ctx);
		};

		it("returns the exit code, both streams, the OS and the shell", async () => {
			const r = await exec({
				command: node(
					"process.stdout.write('out');process.stderr.write('err');process.exit(3)",
				),
			});
			expect(r.ok && r.value).toMatchObject({
				exitCode: 3,
				stdout: "out",
				stderr: "err",
				timedOut: false,
			});
			expect(r.ok && r.value.os.length > 0 && r.value.shell.length > 0).toBe(
				true,
			);
		});

		it("passes env on top of the inherited environment", async () => {
			const r = await exec({
				command: node(
					"process.stdout.write(process.env.METE_KIT+typeof process.env.PATH)",
				),
				env: { METE_KIT: "yes" },
			});
			expect(r.ok && r.value.stdout).toBe("yesstring");
		});

		it("kills a command at its timeout", async () => {
			const r = await exec({
				command: node("setInterval(()=>{},1000)"),
				timeoutSec: 1,
			});
			expect(r.ok && r.value).toMatchObject({ exitCode: null, timedOut: true });
		}, 15_000);

		it("keeps the head and tail of a long stream", async () => {
			const r = await exec({
				command: node(
					"process.stdout.write('a'.repeat(20000)+'b'.repeat(20000))",
				),
			});
			const out = r.ok ? r.value.stdout : "";
			expect(out.startsWith("a".repeat(15_000))).toBe(true);
			expect(out.endsWith("b".repeat(15_000))).toBe(true);
			expect(out).toContain("[10000 characters cut]");
		});

		it("refuses a cwd outside the workspace", async () => {
			const r = await exec({ command: node(""), cwd: ".." });
			expect(r.ok ? undefined : r.error.code).toBe("outside_workspace");
		});

		it("returns the policy's deny and ask without running", async () => {
			for (const [verdict, want] of [
				["deny", "denied"],
				["ask", "approval_required"],
			] as const) {
				const r = await exec({ command: node("process.exit(0)") }, verdict);
				expect(r.ok ? undefined : r.error).toMatchObject({ code: want });
				await close?.();
				close = undefined;
			}
		});
	});
