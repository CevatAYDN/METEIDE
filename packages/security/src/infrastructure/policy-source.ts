import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Policy, PolicySchema } from "@mete/contracts";
import { createConfigReader } from "@mete/kernel";
import { parse } from "yaml";

// The policy as it is now (ADR-073): `.mete/policy.yaml` merged over the `policy:` section of the global
// settings, read again when either file changed. policy.check@1 is synchronous, so the files are
// compared by size and modification time on each check (two stat calls) and read synchronously.
// shortcut: a file that cannot be read for a moment (an editor's lock) counts as an edit that did not
// validate, so the last valid policy stays until the file changes again.

/** Where the two files are. */
export type PolicyDirs = {
	readonly workspaceDir: string;
	readonly globalDir: string;
};

const files = (dirs: PolicyDirs) => ({
	workspace: join(dirs.workspaceDir, ".mete", "policy.yaml"),
	global: join(dirs.globalDir, "settings.yaml"),
});

const codeOf = (e: unknown) =>
	e instanceof Error && "code" in e ? String(e.code) : undefined;

const stampOf = (file: string) => {
	try {
		const s = statSync(file);
		return `${s.mtimeMs}:${s.size}`;
	} catch (e) {
		return codeOf(e) ?? "unreadable";
	}
};

/** What the two files look like now; a different stamp means one of them was written. */
export const policyStamp = (dirs: PolicyDirs) => {
	const f = files(dirs);
	return `${stampOf(f.workspace)}|${stampOf(f.global)}`;
};

// An empty file parses to null and means "nothing set", like a missing one.
const readYaml = (file: string): unknown => {
	try {
		return parse(readFileSync(file, "utf8")) ?? undefined;
	} catch (e) {
		if (codeOf(e) === "ENOENT") return undefined;
		throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
	}
};

const isMapping = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

// Throws a message naming the file; the kernel's reader merges and validates the sections.
const readPolicy = (dirs: PolicyDirs): Policy => {
	const f = files(dirs);
	const global = readYaml(f.global) ?? {};
	if (!isMapping(global))
		throw new Error(`${f.global}: expected a mapping of sections`);
	const reader = createConfigReader({
		global: { file: f.global, sections: global },
		workspace: { policy: { file: f.workspace, value: readYaml(f.workspace) } },
	});
	const r = reader.get("policy", PolicySchema);
	if (!r.ok)
		throw new Error(`${r.error.file} ${r.error.path}: ${r.error.reason}`);
	return r.value;
};

/**
 * The current policy: `first` until a file changes after `since`, then what the files say. An edit that
 * does not parse or validate keeps the last valid policy and reports why once through `warn`.
 */
export const policySource = (
	dirs: PolicyDirs,
	first: Policy,
	warn: (message: string) => void,
	since: string,
): (() => Policy) => {
	let stamp = since;
	let policy = first;
	return () => {
		const now = policyStamp(dirs);
		if (now === stamp) return policy;
		// The stamp is taken before the read, so a write during the read is seen on the next check.
		stamp = now;
		try {
			policy = readPolicy(dirs);
		} catch (e) {
			warn(e instanceof Error ? e.message : String(e));
		}
		return policy;
	};
};
