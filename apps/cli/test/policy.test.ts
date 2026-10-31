import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { recordingIo, silent, tempRepo } from "./helpers.js";

// mete policy check (ADR-167): the verdict for a command without running it, auditing it or
// starting a module.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const LEVEL2 = `autonomy: 2
overrides: { "shell.exec@1": 2 }
shell: { allow: ["npm test"], always: ["git log *"] }
`;

const folder = async (policy: string) => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	close = repo.close;
	await mkdir(join(repo.workspaceDir, ".mete"));
	await writeFile(join(repo.workspaceDir, ".mete", "policy.yaml"), policy);
	const env = {
		cwd: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
	};
	const check = async (...argv: string[]) => {
		const t = recordingIo();
		const code = await main(["policy", ...argv], t.io, env);
		return { code, out: t.out, err: t.err };
	};
	const files = () => readdir(dirname(repo.workspaceDir), { recursive: true });
	return { check, files };
};

describe("mete policy check (ADR-167)", () => {
	it("prints the verdict and the rule, exits 0 allow, 2 ask, 1 deny, and writes nothing", async () => {
		const { check, files } = await folder(LEVEL2);
		const before = await files();
		expect(await check("check", "npm", "test")).toEqual({
			code: 0,
			out: ["allow  shell.allow"],
			err: [],
		});
		expect(await check("check", "pnpm build --watch")).toEqual({
			code: 2,
			out: [
				"ask  autonomy:2",
				"Always allow would add to shell.always: pnpm build *",
			],
			err: [],
		});
		expect(await check("check", "ls *.ts")).toMatchObject({
			code: 2,
			out: ["ask  autonomy:2", expect.stringContaining("cannot be allowed")],
		});
		expect(await check("check", "npm test && kill 1")).toMatchObject({
			code: 1,
			out: [expect.stringMatching(/^deny {2}never_allow:\d+$/)],
		});
		const json = await check("check", "git log -3", "--json");
		expect(json.code).toBe(0);
		expect(JSON.parse(json.out.join("\n"))).toEqual({
			verdict: "allow",
			rule: "shell.always",
		});
		// No audit row, database, log or lock: the folder is as it was.
		expect((await files()).sort()).toEqual(before.sort());
	});

	it("names the file of a policy that does not validate, and prints usage without a command", async () => {
		const { check } = await folder("autonomy: 9\n");
		const bad = await check("check", "npm test");
		expect(bad.code).toBe(1);
		expect(bad.err.join("\n")).toContain("policy.yaml");
		for (const argv of [[], ["check"], ["test", "npm test"]]) {
			const r = await check(...argv);
			expect(r.code).toBe(1);
			expect(r.err.join("\n")).toContain("usage:");
		}
	});
});
