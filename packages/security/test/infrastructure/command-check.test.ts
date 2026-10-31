import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkCommand } from "../../src/infrastructure/command-check.js";

// mete policy check (ADR-167) over a real policy file in a temp folder.

const roots: string[] = [];
afterEach(() => {
	for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const folder = (policy: string) => {
	const root = mkdtempSync(join(tmpdir(), "mete-check-"));
	roots.push(root);
	const dirs = {
		workspaceDir: join(root, "repo"),
		globalDir: join(root, "g"),
		home: join(root, "home"),
		platform: "linux" as const,
	};
	mkdirSync(join(dirs.workspaceDir, ".mete"), { recursive: true });
	writeFileSync(join(dirs.workspaceDir, ".mete", "policy.yaml"), policy);
	return dirs;
};

const LEVEL2 = `autonomy: 2
overrides: { "shell.exec@1": 2 }
shell: { allow: ["npm test"], always: ["git log *"] }
`;

describe("checkCommand (ADR-167)", () => {
	it("names the verdict and the rule as a run would get them", () => {
		const dirs = folder(LEVEL2);
		expect(checkCommand(dirs, "npm test")).toEqual({
			ok: true,
			value: { verdict: "allow", rule: "shell.allow" },
		});
		expect(checkCommand(dirs, "git log --oneline")).toMatchObject({
			value: { verdict: "allow", rule: "shell.always" },
		});
		expect(checkCommand(dirs, "kill 12")).toMatchObject({
			value: { verdict: "deny", rule: expect.stringMatching(/^never_allow:/) },
		});
	});

	it("gives the entry Always allow would write, only where it would help", () => {
		const dirs = folder(LEVEL2);
		expect(checkCommand(dirs, "pnpm build --watch")).toEqual({
			ok: true,
			value: { verdict: "ask", rule: "autonomy:2", always: "pnpm build *" },
		});
		expect(checkCommand(dirs, "ls *.ts")).toEqual({
			ok: true,
			value: { verdict: "ask", rule: "autonomy:2" },
		});
		const asked = folder(`${LEVEL2}always_ask: [shell.exec]\n`);
		expect(checkCommand(asked, "pnpm build --watch")).toEqual({
			ok: true,
			value: { verdict: "ask", rule: "always_ask" },
		});
	});

	it("names the file of a policy that does not validate", () => {
		const r = checkCommand(folder("autonomy: 9\n"), "npm test");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toContain("policy.yaml");
	});
});
