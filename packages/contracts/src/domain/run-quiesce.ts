import { z } from "zod";
import type { EngineError } from "./engine.js";
import type { Result } from "./result.js";

export const DaemonQuiesceParamsSchema = z.strictObject({});
export const DaemonQuiesceResultSchema = z.null();

/** Atomically stop accepting work only when no run or start operation is active (ADR-180). */
export interface RunQuiesceAdapter {
	prepare(): Promise<Result<null, EngineError>>;
}
