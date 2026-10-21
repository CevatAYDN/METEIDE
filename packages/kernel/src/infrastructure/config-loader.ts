import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { err, IdSchema, ok, type Result } from "@mete/contracts";
import { parse } from "yaml";
import { z } from "zod";
import type { BindingReader } from "../domain/capability-registry.js";
import {
	BindingsSchema,
	type ConfigLayers,
	createConfigReader,
} from "../domain/config-reader.js";
import type { ConfigInvalid, ConfigReader } from "../domain/module.js";
import { withLockRetry } from "./platform.js";

// Configuration files from ARCHITECTURE.md (Data locations, Configuration).

/** Where to look: the global data folder and the workspace root. */
export type ConfigDirs = {
	readonly globalDir: string;
	readonly workspaceDir: string;
};

/** What the composition root needs to start the kernel. */
export type LoadedConfig = {
	readonly workspaceId: string;
	readonly reader: ConfigReader;
	readonly bindings: BindingReader;
};

type Parsed = Result<unknown, ConfigInvalid>;

const invalid = (file: string, reason: string): ConfigInvalid => ({
	code: "config_invalid",
	file,
	path: "",
	reason,
});

const isMissing = (e: unknown) =>
	e instanceof Error && "code" in e && e.code === "ENOENT";

// An empty file parses to null and means "nothing set", like a missing one.
const readYaml = async (file: string): Promise<Parsed> => {
	let text: string;
	try {
		text = await withLockRetry(() => readFile(file, "utf8"));
	} catch (e) {
		if (isMissing(e)) return ok(undefined);
		throw e;
	}
	try {
		return ok(parse(text) ?? undefined);
	} catch (e) {
		return err(invalid(file, e instanceof Error ? e.message : String(e)));
	}
};

// `wx` never overwrites: a workspace opened twice at once keeps the first id.
const ensureWorkspaceFile = async (metaDir: string) => {
	await mkdir(metaDir, { recursive: true });
	const file = join(metaDir, "workspace.yaml");
	const text = `id: ${crypto.randomUUID()}\n`;
	await withLockRetry(() => writeFile(file, text, { flag: "wx" })).catch(
		(e: unknown) => {
			if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
		},
	);
};

const readWorkspaceFiles = async (metaDir: string, errors: ConfigInvalid[]) => {
	const names = await withLockRetry(() => readdir(metaDir));
	const files: Record<string, { file: string; value: unknown }> = {};
	for (const name of names.filter((n) => extname(n) === ".yaml").sort()) {
		const file = join(metaDir, name);
		const parsed = await readYaml(file);
		if (parsed.ok)
			files[basename(name, ".yaml")] = { file, value: parsed.value };
		else errors.push(parsed.error);
	}
	return files;
};

const readGlobal = async (globalDir: string, errors: ConfigInvalid[]) => {
	const file = join(globalDir, "settings.yaml");
	const parsed = await readYaml(file);
	if (!parsed.ok) errors.push(parsed.error);
	const value = parsed.ok ? (parsed.value ?? {}) : {};
	if (typeof value === "object" && value !== null && !Array.isArray(value))
		return { file, sections: value as Readonly<Record<string, unknown>> };
	errors.push(invalid(file, "expected a mapping of sections"));
	return { file, sections: {} };
};

const WorkspaceSchema = z.looseObject({ id: IdSchema });

/** Loads global settings and `.mete/*.yaml`, creating `workspace.yaml` when missing. */
export const loadConfig = async (
	dirs: ConfigDirs,
): Promise<Result<LoadedConfig, ReadonlyArray<ConfigInvalid>>> => {
	const metaDir = join(dirs.workspaceDir, ".mete");
	await ensureWorkspaceFile(metaDir);
	const errors: ConfigInvalid[] = [];
	const layers: ConfigLayers = {
		global: await readGlobal(dirs.globalDir, errors),
		workspace: await readWorkspaceFiles(metaDir, errors),
	};
	const reader = createConfigReader(layers);
	const workspace = reader.get("workspace", WorkspaceSchema);
	const bindings = reader.get("bindings", BindingsSchema.optional());
	if (!workspace.ok) errors.push(workspace.error);
	if (!bindings.ok) errors.push(bindings.error);
	if (errors.length > 0 || !workspace.ok || !bindings.ok) return err(errors);
	const map = bindings.value ?? {};
	return ok({
		workspaceId: workspace.value.id,
		reader,
		bindings: (ref) => map[ref] ?? [],
	});
};
