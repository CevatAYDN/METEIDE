import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Policy, PolicySchema } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	policySource,
	policyStamp,
} from "../../src/infrastructure/policy-source.js";

// The policy read again when its files change (ADR-073), over real files in a temp folder.

const roots: string[] = [];
afterEach(() => {
	for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const setup = () => {
	const root = mkdtempSync(join(tmpdir(), "mete-policy-"));
	roots.push(root);
	const dirs = { workspaceDir: join(root, "repo"), globalDir: join(root, "g") };
	mkdirSync(join(dirs.workspaceDir, ".mete"), { recursive: true });
	mkdirSync(dirs.globalDir, { recursive: true });
	const warnings: string[] = [];
	const first: Policy = PolicySchema.parse({});
	let tick = 1_000_000;
	// An edit that lands in the same millisecond still changes the stamp: the mtime moves on each write.
	const put = (file: string, text: string) => {
		writeFileSync(file, text);
		tick += 5_000;
		utimesSync(file, tick / 1000, tick / 1000);
	};
	return {
		dirs,
		first,
		warnings,
		source: policySource(
			dirs,
			first,
			(m) => warnings.push(m),
			policyStamp(dirs),
		),
		workspace: (text: string) =>
			put(join(dirs.workspaceDir, ".mete", "policy.yaml"), text),
		global: (text: string) => put(join(dirs.globalDir, "settings.yaml"), text),
		remove: () => rmSync(join(dirs.workspaceDir, ".mete", "policy.yaml")),
	};
};

describe("policySource", () => {
	it("keeps the policy it was given while no file changed", () => {
		const s = setup();
		expect(s.source()).toBe(s.first);
		expect(s.source()).toBe(s.first);
		expect(s.warnings).toEqual([]);
	});

	it("takes up a policy file that appears and each edit after it", () => {
		const s = setup();
		s.workspace("autonomy: 1\n");
		expect(s.source().autonomy).toBe(1);
		s.workspace(
			"autonomy: 3\nnever_allow:\n  - action: shell.exec\n    command: rm -rf *\n",
		);
		const now = s.source();
		expect(now.autonomy).toBe(3);
		expect(now.never_allow).toEqual([
			{ action: "shell.exec", command: "rm -rf *" },
		]);
	});

	it("merges the global policy section under the workspace file, as the kernel does", () => {
		const s = setup();
		s.global("policy:\n  autonomy: 3\n  shell:\n    allow: [git status]\n");
		expect(s.source().autonomy).toBe(3);
		s.workspace("autonomy: 1\n");
		const now = s.source();
		expect(now.autonomy).toBe(1);
		expect(now.shell.allow).toEqual(["git status"]);
	});

	it("keeps the last valid policy through an edit that does not validate, says why once, and takes the fix", () => {
		const s = setup();
		s.workspace("autonomy: 1\n");
		expect(s.source().autonomy).toBe(1);
		s.workspace("autonomy: 9\n");
		expect(s.source().autonomy).toBe(1);
		expect(s.source().autonomy).toBe(1);
		expect(s.warnings).toHaveLength(1);
		expect(s.warnings[0]).toContain("policy.yaml");
		s.workspace("autonomy: [unclosed\n");
		expect(s.source().autonomy).toBe(1);
		expect(s.warnings).toHaveLength(2);
		s.workspace("autonomy: 3\n");
		expect(s.source().autonomy).toBe(3);
		expect(s.warnings).toHaveLength(2);
	});

	it("returns to the defaults when the policy file is deleted", () => {
		const s = setup();
		s.workspace("autonomy: 1\n");
		expect(s.source().autonomy).toBe(1);
		s.remove();
		expect(s.source()).toEqual(PolicySchema.parse({}));
	});
});
