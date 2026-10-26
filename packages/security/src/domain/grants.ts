import type { PolicyAsk, PolicyCheckInput } from "@mete/contracts";
import { collapse, normalizePath, type PathEnv } from "./patterns.js";

// Which later checks the human's answer to an ask covers (SECURITY.md, Answering an ask; ADR-121).
// Pure.

// A field the ask left out matches anything; one it named must be there and the same.
const same = (
	asked: string | undefined,
	checked: string | undefined,
	norm: (s: string) => string,
) =>
	asked === undefined ||
	(checked !== undefined && norm(asked) === norm(checked));

/** Whether a grant of the ask covers the check: same action, capability, adapter, command and path. */
export const covers = (
	ask: PolicyAsk,
	input: PolicyCheckInput,
	env: PathEnv,
): boolean =>
	ask.action === input.action &&
	ask.capability === input.capability &&
	ask.adapterId === input.adapterId &&
	same(ask.command, input.command, collapse) &&
	same(ask.path, input.path, (p) => normalizePath(p, env));
