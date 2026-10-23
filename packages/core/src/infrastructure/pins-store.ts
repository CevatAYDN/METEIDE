import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Pins, PinsSchema, type Result } from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { parse } from "yaml";

// The folder's pinned models (ADR-077): .mete/pins.yaml, read from disk each time it is asked, as a
// team file is, so a pin the team editor saved needs no restart. A missing file is no pins.

const codeOf = (e: unknown) =>
	typeof e === "object" && e !== null && "code" in e ? e.code : undefined;

/** The workspace's pins, or why its pins file cannot be used, naming the file. */
export const readPins = async (
	workspace: string,
): Promise<Result<Pins, string>> => {
	const file = join(workspace, ".mete", "pins.yaml");
	let text: string;
	try {
		text = await withLockRetry(() => readFile(file, "utf8"));
	} catch (e) {
		return codeOf(e) === "ENOENT" ? ok({}) : err(`${file}: ${String(e)}`);
	}
	let data: unknown;
	try {
		data = parse(text) ?? undefined;
	} catch (e) {
		return err(`${file}: ${e instanceof Error ? e.message : String(e)}`);
	}
	const r = PinsSchema.safeParse(data);
	return r.success
		? ok(r.data)
		: err(
				`${file}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
			);
};
