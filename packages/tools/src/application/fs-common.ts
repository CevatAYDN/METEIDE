import {
	err,
	ok,
	type PolicyAction,
	type PolicyCheckAdapter,
	type Result,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import type { ZodType } from "zod";
import { absolute, isInside } from "../domain/paths.js";
import { realTarget } from "../infrastructure/files.js";
import {
	type IgnoreCheck,
	loadIgnore,
} from "../infrastructure/ignore-rules.js";

// What every fs tool shares: where a path really is, the ignore rules and the policy check.

/** Real paths of the workspace and the global worktrees/ folder, and the policy resolver. */
export type FsDeps = {
	readonly adapterId: string;
	readonly workspaceDir: string;
	readonly worktreesDir: string;
	readonly policy: () => PolicyCheckAdapter | undefined;
};

export type Place = {
	readonly real: string;
	/** Inside the workspace or the worktrees folder. */
	readonly inside: boolean;
	/** The workspace or worktrees folder holding it, when inside. */
	readonly root: string;
};

/** Where an input path really is, after symbolic links. */
export const place = async (deps: FsDeps, path: string): Promise<Place> => {
	const real = await realTarget(absolute(deps.workspaceDir, path));
	if (isInside(deps.workspaceDir, real))
		return { real, inside: true, root: deps.workspaceDir };
	const inTree = isInside(deps.worktreesDir, real);
	return { real, inside: inTree, root: deps.worktreesDir };
};

export const outside = (path: string): ToolError => ({
	code: "outside_workspace",
	message: `${path} is outside the workspace and the worktrees`,
});

export const ignoredError = (path: string): ToolError => ({
	code: "ignored",
	message: `${path} is excluded by .meteignore`,
});

/** The ignore rules as they are now. */
export const rules = (deps: FsDeps): Promise<Result<IgnoreCheck, ToolError>> =>
	loadIgnore(deps.workspaceDir, deps.worktreesDir);

/** Parses a model's input at the boundary. */
export const parse = <T>(
	schema: ZodType<T>,
	input: unknown,
): Result<T, ToolError> => {
	const r = schema.safeParse(input);
	return r.success
		? ok(r.data)
		: err({ code: "bad_input", message: r.error.message });
};

const caller = (ctx: ToolContext) => ({
	...(ctx.runId === undefined ? {} : { runId: ctx.runId }),
	...(ctx.agentId === undefined ? {} : { agentId: ctx.agentId }),
	...(ctx.tainted === undefined ? {} : { tainted: ctx.tainted }),
});

/** Asks policy.check@1; deny and ask come back as errors with the rule (docs/10). */
export const permit = (
	deps: FsDeps,
	check: {
		action: PolicyAction;
		capability: `${string}@1`;
		path: string;
		args: unknown;
	},
	ctx: ToolContext,
): Result<void, ToolError> => {
	const policy = deps.policy();
	if (!policy)
		return err({
			code: "denied",
			rule: "capability_missing",
			message: "policy.check@1 is not provided",
		});
	const v = policy.check({
		...check,
		adapterId: deps.adapterId,
		...caller(ctx),
	});
	if (!v.ok)
		return err({
			code: "denied",
			rule: "audit_failed",
			message: v.error.message,
		});
	const { verdict, rule } = v.value;
	if (verdict === "allow") return ok(undefined);
	const code = verdict === "ask" ? "approval_required" : "denied";
	return err({
		code,
		rule,
		message: `${check.action} ${check.path}: ${verdict} (${rule})`,
	});
};
