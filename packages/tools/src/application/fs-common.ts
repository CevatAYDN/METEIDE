import {
	type CapabilityRef,
	err,
	ok,
	type PolicyAction,
	type PolicyCheckAdapter,
	type Result,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import type { ZodType } from "zod";
import { absolute, isInside, namesStream } from "../domain/paths.js";
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
	/** Set for a call in a worktree: the real folders `.meteignore` is read from and anchored in. */
	readonly ignore?: {
		readonly workspaceDir: string;
		readonly worktreesDir: string;
	};
};

/**
 * The deps for one call. A call with a working folder (ToolContext.cwd, a task's worktree) sees it as
 * the workspace and is confined to it, while `.meteignore` still comes from the real workspace.
 */
export const scoped = async <D extends FsDeps>(
	deps: D,
	ctx: ToolContext,
): Promise<Result<D, ToolError>> => {
	if (ctx.cwd === undefined) return ok(deps);
	const real = await realTarget(ctx.cwd);
	if (real === deps.worktreesDir || !isInside(deps.worktreesDir, real))
		return err({
			code: "bad_input",
			message: `${ctx.cwd} is not a folder inside the worktrees folder`,
		});
	const ignore = deps.ignore ?? {
		workspaceDir: deps.workspaceDir,
		worktreesDir: deps.worktreesDir,
	};
	return ok({ ...deps, workspaceDir: real, worktreesDir: real, ignore });
};

export type Place = {
	readonly real: string;
	/** Inside the workspace or the worktrees folder. */
	readonly inside: boolean;
	/** The workspace or worktrees folder holding it, when inside. */
	readonly root: string;
};

const WINDOWS = process.platform === "win32";

/** Where an input path really is, after symbolic links; an NTFS stream name is refused (docs/10). */
export const place = async (
	deps: FsDeps,
	path: string,
): Promise<Result<Place, ToolError>> => {
	const abs = absolute(deps.workspaceDir, path);
	if (WINDOWS && namesStream(abs))
		return err({ code: "bad_input", message: `${path} names a file stream` });
	const real = await realTarget(abs);
	if (isInside(deps.workspaceDir, real))
		return ok({ real, inside: true, root: deps.workspaceDir });
	const inTree = isInside(deps.worktreesDir, real);
	return ok({ real, inside: inTree, root: deps.worktreesDir });
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
	loadIgnore(
		deps.ignore?.workspaceDir ?? deps.workspaceDir,
		deps.ignore?.worktreesDir ?? deps.worktreesDir,
	);

/** Where a path to write or edit really is; refused when .meteignore excludes it (docs/10). */
export const placeToChange = async (
	deps: FsDeps,
	path: string,
): Promise<Result<Place, ToolError>> => {
	const at = await place(deps, path);
	if (!at.ok) return at;
	const ignored = await rules(deps);
	if (!ignored.ok) return ignored;
	return ignored.value(at.value.real) ? err(ignoredError(path)) : at;
};

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
	deps: Pick<FsDeps, "adapterId" | "policy">,
	check: {
		action: PolicyAction;
		capability: CapabilityRef;
		path?: string;
		command?: string;
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
		message: `${check.action} ${check.path ?? check.command}: ${verdict} (${rule})`,
	});
};
