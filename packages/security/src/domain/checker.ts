import type {
	Policy,
	PolicyAction,
	PolicyCheckInput,
	PolicyVerdict,
} from "@mete/contracts";
import { PROTECTED_PATHS, SCRIPT_MANIFESTS } from "../defaults.js";
import {
	commandMatches,
	commandParts,
	hasShellOperator,
	isInside,
	normalizePath,
	type PathEnv,
	pathMatches,
} from "./patterns.js";

// The decision order from SECURITY.md (Policy file); each verdict names its step.

/** The policy plus the folders and OS rules the decision depends on. */
export type CheckerEnv = PathEnv & {
	readonly policy: Policy;
	readonly globalDir: string;
};

const WRITES: ReadonlySet<PolicyAction> = new Set([
	"fs.write",
	"fs.delete",
	"fs.write.outside",
]);
const LEVEL2_ALLOWED: ReadonlySet<PolicyAction> = new Set([
	"git.commit",
	"net.fetch",
	"runtime.install",
]);

const verdict = (v: PolicyVerdict["verdict"], rule: string): PolicyVerdict => ({
	verdict: v,
	rule,
});

// Writes are safe in the workspace and the global worktrees/ and snapshots/ folders.
const isSafeWrite = (path: string, env: CheckerEnv) =>
	[
		env.workspaceDir,
		`${env.globalDir}/worktrees`,
		`${env.globalDir}/snapshots`,
	].some((dir) => isInside(normalizePath(dir, env), normalizePath(path, env)));

// A task's worktree is a copy of the workspace that is merged back into it (docs/08), so the rules
// that name a workspace path (never_allow, protected paths, script manifests) judge a path inside
// one as the same path in the workspace: its copy of .mete/policy.yaml is as off limits as the original.
const asWorkspacePath = (path: string, env: CheckerEnv) => {
	const base = normalizePath(`${env.globalDir}/worktrees`, env);
	const full = normalizePath(path, env);
	if (!isInside(base, full)) return path;
	const [run, task, ...rest] = full.slice(base.length + 1).split("/");
	return run && task ? normalizePath(rest.join("/"), env) : path;
};

// What the rules see: the input with its inputs checked and a write outside the
// safe folders classified as fs.write.outside, so every step agrees on the action.
type Subject = {
	readonly action: PolicyAction;
	readonly capability: PolicyCheckInput["capability"];
	readonly path: string;
	readonly command: string;
	readonly safeWrite: boolean;
};

const subjectOf = (
	input: PolicyCheckInput,
	env: CheckerEnv,
): Subject | undefined => {
	const write = WRITES.has(input.action);
	if (write && !input.path) return undefined;
	if (input.action === "shell.exec" && !input.command) return undefined;
	const path = input.path ?? "";
	const safeWrite = write && isSafeWrite(path, env);
	const outside = input.action === "fs.write" && !safeWrite;
	return {
		action: outside ? "fs.write.outside" : input.action,
		capability: input.capability,
		path: asWorkspacePath(path, env),
		command: input.command ?? "",
		safeWrite,
	};
};

// A fs.write rule covers all three write actions; any other rule names one action.
const neverAllowed = (s: Subject, env: CheckerEnv) =>
	env.policy.never_allow.findIndex((rule) =>
		"command" in rule
			? s.action === "shell.exec" &&
				// A deny rule ignores case, as PowerShell and Windows programs do (ADR-063).
				[s.command, ...commandParts(s.command)].some((c) =>
					commandMatches(rule.command, c, true),
				)
			: WRITES.has(s.action) &&
				(rule.action === "fs.write" || rule.action === s.action) &&
				pathMatches(rule.path, s.path, env),
	);

const isProtected = (path: string, env: CheckerEnv) =>
	PROTECTED_PATHS.some((p) => pathMatches(p, path, env));

// Steps 2 and 3: rules that deny at every level.
const hardDeny = (s: Subject, env: CheckerEnv): PolicyVerdict | undefined => {
	const rule = neverAllowed(s, env);
	if (rule >= 0) return verdict("deny", `never_allow:${rule}`);
	if (WRITES.has(s.action) && isProtected(s.path, env))
		return verdict("deny", "protected_path");
	return undefined;
};

const isScriptManifest = (path: string, env: CheckerEnv) =>
	SCRIPT_MANIFESTS.some((p) => pathMatches(p, path, env));

// Step 8: a command the user allowed for good (ADR-121), not on a tainted step; an entry with `*`
// is a pattern (ADR-158) and, as in shell.allow, never covers a command with a shell operator.
const allowedForGood = (s: Subject, tainted: boolean, env: CheckerEnv) =>
	s.action === "shell.exec" &&
	!tainted &&
	env.policy.shell.always.some(
		(c) =>
			commandMatches(c, s.command) &&
			(!c.includes("*") || !hasShellOperator(s.command)),
	);

// Step 10: level 2 allowances; anything else asks.
const levelTwo = (s: Subject, env: CheckerEnv) => {
	if (s.action === "fs.write")
		return isScriptManifest(s.path, env)
			? verdict("ask", "autonomy:2:script_manifest")
			: verdict("allow", "autonomy:2:inside");
	if (
		s.action === "shell.exec" &&
		!hasShellOperator(s.command) &&
		env.policy.shell.allow.some((p) => commandMatches(p, s.command))
	)
		return verdict("allow", "shell.allow");
	if (LEVEL2_ALLOWED.has(s.action))
		return verdict("allow", "autonomy:2:action");
	return verdict("ask", "autonomy:2");
};

// Steps 7 to 10, at levels 1 and 2.
const levelOneOrTwo = (
	s: Subject,
	tainted: boolean,
	level: number,
	env: CheckerEnv,
) => {
	if (env.policy.always_ask.includes(s.action))
		return verdict("ask", "always_ask");
	if (allowedForGood(s, tainted, env)) return verdict("allow", "shell.always");
	if (level === 1) return verdict("ask", "autonomy:1");
	return levelTwo(s, env);
};

/** Decides one side-effect action; pure, so the audit row is the caller's job. */
export const decide = (
	input: PolicyCheckInput,
	env: CheckerEnv,
): PolicyVerdict => {
	const s = subjectOf(input, env);
	if (!s) return verdict("deny", "missing_input");
	const denied = hardDeny(s, env);
	if (denied) return denied;
	const { autonomy, overrides } = env.policy;
	const level = Math.min(autonomy, overrides[s.capability] ?? autonomy);
	if (level === 0) return verdict("deny", "autonomy:0");
	if (level === 3)
		return WRITES.has(s.action) && !s.safeWrite
			? verdict("deny", "autonomy:3:outside")
			: verdict("allow", "autonomy:3");
	return levelOneOrTwo(s, input.tainted === true, level, env);
};
