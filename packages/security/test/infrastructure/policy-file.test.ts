import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicySchema } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { allowCommandForGood } from "../../src/infrastructure/policy-file.js";

// Always allow (ADR-121) writes the exact command to shell.always in the folder's policy file.

let root: string | undefined;
afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

const folder = async (policy?: string) => {
	root = await mkdtemp(join(tmpdir(), "mete-policy-file-"));
	if (policy !== undefined) {
		await mkdir(join(root, ".mete"));
		await writeFile(join(root, ".mete", "policy.yaml"), policy);
	}
	return { dir: root, file: join(root, ".mete", "policy.yaml") };
};

describe("allowCommandForGood", () => {
	it("creates the file with the command, trimmed and with collapsed spaces", async () => {
		const f = await folder();
		expect(await allowCommandForGood(f.dir, "  npm   install ")).toEqual({
			ok: true,
			value: f.file,
		});
		const policy = PolicySchema.parse(parse(await readFile(f.file, "utf8")));
		expect(policy.shell.always).toEqual(["npm install"]);
		expect(policy.shell.allow).toContain("pnpm *");
	});

	it("keeps comments and other keys, appends to the list and adds a command once", async () => {
		const f = await folder(
			'# mine\nautonomy: 2\nshell:\n  allow: ["git status"]\n  always: ["npm test"]\n',
		);
		await allowCommandForGood(f.dir, "npm install");
		await allowCommandForGood(f.dir, "npm install");
		const text = await readFile(f.file, "utf8");
		expect(text).toContain("# mine");
		expect(parse(text)).toEqual({
			autonomy: 2,
			shell: { allow: ["git status"], always: ["npm test", "npm install"] },
		});
	});

	it("writes nothing to a file that is no map of settings or does not parse", async () => {
		for (const bad of ["- a\n- b\n", "shell: [\n"]) {
			const f = await folder(bad);
			const r = await allowCommandForGood(f.dir, "npm install");
			expect(r.ok).toBe(false);
			expect(await readFile(f.file, "utf8")).toBe(bad);
			await rm(f.dir, { recursive: true, force: true });
		}
	});

	it("refuses an empty command", async () => {
		const f = await folder();
		expect((await allowCommandForGood(f.dir, "  ")).ok).toBe(false);
	});
});
