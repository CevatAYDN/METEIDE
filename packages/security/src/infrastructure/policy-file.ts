import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { isMap, isSeq, parseDocument } from "yaml";
import { collapse } from "../domain/patterns.js";

// Always allow (ADR-121): adds a command to `shell.always` in the folder's .mete/policy.yaml, for
// `mete allow --always` and the desktop's card, which act on the user's own answer (SECURITY.md,
// Protected paths; ADR-072). Comments and the other keys stay as they are.

const load = async (file: string) => {
	try {
		return await readFile(file, "utf8");
	} catch (e) {
		if (e instanceof Error && "code" in e && e.code === "ENOENT") return "";
		throw e;
	}
};

// Written beside the file and renamed over it, so the policy is never read half written.
const replace = async (file: string, text: string) => {
	const temp = `${file}.${process.pid}.tmp`;
	try {
		await writeFile(temp, text);
		await withLockRetry(() => rename(temp, file));
	} catch (e) {
		await rm(temp, { force: true });
		throw e;
	}
};

/** Adds the command, trimmed and with collapsed spaces; the file's path, or why it was not written. */
export const allowCommandForGood = async (
	workspaceDir: string,
	command: string,
): Promise<Result<string, string>> => {
	const file = join(workspaceDir, ".mete", "policy.yaml");
	const exact = collapse(command);
	if (exact === "") return err("an empty command cannot be allowed");
	const doc = parseDocument(await load(file));
	if (doc.errors.length > 0) return err(`${file}: ${doc.errors[0]?.message}`);
	if (doc.contents !== null && !isMap(doc.contents))
		return err(`${file} is not a map of settings`);
	const always = doc.getIn(["shell", "always"]);
	if (!isSeq(always)) doc.setIn(["shell", "always"], doc.createNode([exact]));
	else if (!always.toJSON().includes(exact)) always.add(exact);
	else return ok(file);
	await mkdir(dirname(file), { recursive: true });
	await replace(file, doc.toString());
	return ok(file);
};
