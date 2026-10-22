import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type AdapterMapping, AdapterMappingSchema } from "@mete/contracts";
import { parse } from "yaml";

// Level 2 mapping files from the built-in adapters/ folder (ARCHITECTURE.md, repository layout).

export type MappingFile = {
	readonly file: string;
	readonly mapping: AdapterMapping;
};
export type BrokenFile = { readonly file: string; readonly reason: string };

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

// A missing folder holds no mappings; any other read failure is reported as broken.
const names = async (dir: string): Promise<string[] | BrokenFile> => {
	try {
		return (await readdir(dir)).filter((f) => f.endsWith(".yaml")).sort();
	} catch (e) {
		if (e instanceof Error && "code" in e && e.code === "ENOENT") return [];
		return { file: dir, reason: why(e) };
	}
};

const readOne = async (file: string): Promise<MappingFile | BrokenFile> => {
	try {
		const r = AdapterMappingSchema.safeParse(
			parse(await readFile(file, "utf8")),
		);
		if (r.success) return { file, mapping: r.data };
		const issues = r.error.issues.map(
			(i) => `${i.path.join(".")}: ${i.message}`,
		);
		return { file, reason: issues.join("; ") };
	} catch (e) {
		return { file, reason: why(e) };
	}
};

/** Every mapping in the folder, and the files that could not be read or failed the schema. */
export const loadMappings = async (dir: string) => {
	const files = await names(dir);
	if (!Array.isArray(files)) return { mappings: [], broken: [files] };
	const read = await Promise.all(files.map((f) => readOne(join(dir, f))));
	return {
		mappings: read.filter((r): r is MappingFile => "mapping" in r),
		broken: read.filter((r): r is BrokenFile => "reason" in r),
	};
};
