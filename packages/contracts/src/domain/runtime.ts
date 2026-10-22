import { z } from "zod";
import type { ToolAdapter } from "./tools.js";

// runtime.ensure@1 from docs/10 (Managed runtimes): a runtime a child process needs, found or
// downloaded on demand; the caller puts binDir first on the child's PATH.

/** Input of runtime.ensure@1: a managed runtime by name, or a native binary by its pinned download. */
export const RuntimeEnsureInputSchema = z.discriminatedUnion("runtime", [
	z.strictObject({ runtime: z.enum(["node", "python", "container"]) }),
	z.strictObject({
		runtime: z.literal("binary"),
		url: z.url({ protocol: /^https$/ }),
		sha256: z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase SHA-256"),
	}),
]);
export type RuntimeEnsureInput = z.input<typeof RuntimeEnsureInputSchema>;

/** The folder that holds the runtime's commands (npx, uvx, docker or the binary). */
export type RuntimeEnsureOutput = { readonly binDir: string };

/** runtime.ensure@1; asks policy.check@1 with action runtime.install before any download. */
export type RuntimeEnsureAdapter = ToolAdapter<
	RuntimeEnsureInput,
	RuntimeEnsureOutput
>;
