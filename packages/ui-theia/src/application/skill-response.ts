import { err, type Result } from "@mete/contracts";
import type { z } from "zod";
import type { DaemonFailure } from "../domain/daemon-failure.js";

/** Parse the inner protocol envelope even when the outer Theia transport succeeded. */
export const receiveSkillResponse = async <T>(
	call: Promise<Result<T, DaemonFailure>>,
	schema: z.ZodType<T>,
): Promise<Result<T, DaemonFailure>> => {
	try {
		const result = await call;
		if (!result.ok) return result;
		const parsed = schema.safeParse(result.value);
		return parsed.success
			? { ok: true, value: parsed.data }
			: err({ code: "protocol", detail: "Invalid skill response" });
	} catch {
		return err({ code: "protocol", detail: "Skill transport unavailable" });
	}
};
