import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	err,
	ok,
	type RegistryEntry,
	type RegistrySearchAdapter,
	RegistrySearchInputSchema,
	type Result,
	type ToolError,
} from "@mete/contracts";
import { z } from "zod";
import { REGISTRY_SEARCH_LIMIT } from "../defaults.js";
import { LocalIndexSchema, matching } from "../domain/local-registry.js";

// registry.search@1 over the local registry (docs/10, Registries): a read of one file in the global
// folder, which is no policy action, so it asks policy.check@1 nothing.

const failed = (file: string, message: string) =>
	err<ToolError>({ code: "io", message: `local registry ${file}: ${message}` });

// A folder nobody set up has no file: that is an empty registry, not an error.
const read = async (
	file: string,
): Promise<Result<string | undefined, ToolError>> => {
	try {
		return ok(await readFile(file, "utf8"));
	} catch (e) {
		if (e instanceof Error && "code" in e && e.code === "ENOENT")
			return ok(undefined);
		return failed(file, e instanceof Error ? e.message : String(e));
	}
};

const entriesOf = (
	file: string,
	text: string,
): Result<readonly RegistryEntry[], ToolError> => {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return failed(file, "is not valid JSON");
	}
	const index = LocalIndexSchema.safeParse(json);
	return index.success
		? ok(index.data.entries)
		: failed(file, z.prettifyError(index.error).split("\n")[0] ?? "");
};

/** The local registry's entries that match the query; an unreadable or invalid file is `io` naming it. */
export const localRegistry = (globalDir: string): RegistrySearchAdapter => {
	const file = join(globalDir, "registry", "index.json");
	return {
		run: async (raw) => {
			const input = RegistrySearchInputSchema.safeParse(raw);
			if (!input.success)
				return err({
					code: "bad_input",
					message: z.prettifyError(input.error),
				});
			const text = await read(file);
			if (!text.ok) return text;
			if (text.value === undefined) return ok({ entries: [] });
			const entries = entriesOf(file, text.value);
			if (!entries.ok) return entries;
			const found = matching(entries.value, input.data);
			return ok({ entries: found.slice(0, REGISTRY_SEARCH_LIMIT) });
		},
	};
};
