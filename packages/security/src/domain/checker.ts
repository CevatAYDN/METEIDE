import type {
	Policy,
	PolicyAction,
	PolicyCheckInput,
	PolicyVerdict,
} from "@mete/contracts";
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
// SECURITY.md, Protected paths: a re-include line in .meteignore would open what it hides.
const PROTECTED = [
	".mete/policy.yaml",
	".mete/bindings.yaml",
	".mete/mcp.yaml",
	".meteignore",
];
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
		path,
		command: input.command ?? "",
		safeWrite,
	};
};

// A fs.write rule covers all three write actions; any other rule names one action.
const neverAllowed = (s: Subject, env: CheckerEnv) =>
	env.policy.never_allow.findIndex((rule) =>
		"command" in rule
			? s.action === "shell.exec" &&
				[s.command, ...commandParts(s.command)].some((c) =>
					commandMatches(rule.command, c),
				)
			: WRITES.has(s.action) &&
				(rule.action === "fs.write" || rule.action === s.action) &&
				pathMatches(rule.path, s.path, env),
	);

const isProtected = (path: string, env: CheckerEnv) =>
	PROTECTED.some((f) => normalizePath(f, env) === normalizePath(path, env));

// Steps 2 and 3: rules that deny at every level.
const hardDeny = (s: Subject, env: CheckerEnv): PolicyVerdict | undefined => {
	const rule = neverAllowed(s, env);
	if (rule >= 0) return verdict("deny", `never_allow:${rule}`);
	if (WRITES.has(s.action) && isProtected(s.path, env))
		return verdict("deny", "protected_path");
	return undefined;
};

// Step 9: level 2 allowances; anything else asks.
const levelTwo = (s: Subject, env: CheckerEnv) => {
	if (s.action === "fs.write") return verdict("allow", "autonomy:2:inside");
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
	if (env.policy.always_ask.includes(s.action))
		return verdict("ask", "always_ask");
	if (level === 1) return verdict("ask", "autonomy:1");
	return levelTwo(s, env);
};
