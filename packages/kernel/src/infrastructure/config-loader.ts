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
	/** The files read, before any schema: the read-only Settings screen shows them (ADR-081). */
	readonly layers: ConfigLayers;
};

type Parsed = Result<unknown, ConfigInvalid>;

const invalid = (file: string, reason: string): ConfigInvalid => ({
	code: "config_invalid",
	file,
	path: "",
	reason,
});

const codeOf = (e: unknown) =>
	e instanceof Error && "code" in e && typeof e.code === "string"
		? e.code
		: undefined;

// An unreadable file is the environment, not a bug, so it is reported like invalid content.
const unreadable = (file: string, e: unknown) =>
	invalid(
		file,
		e instanceof Error ? `${codeOf(e) ?? e.name}: ${e.message}` : String(e),
	);

// An empty file parses to null and means "nothing set", like a missing one.
const readYaml = async (file: string): Promise<Parsed> => {
	let text: string;
	try {
		text = await withLockRetry(() => readFile(file, "utf8"));
	} catch (e) {
		return codeOf(e) === "ENOENT" ? ok(undefined) : err(unreadable(file, e));
	}
	try {
		return ok(parse(text) ?? undefined);
	} catch (e) {
		return err(invalid(file, e instanceof Error ? e.message : String(e)));
	}
};

// `wx` never overwrites: a workspace opened twice at once keeps the first id,
// and a user's own .gitignore stays as it is.
const createOnce = async (file: string, text: string) => {
	try {
		await withLockRetry(() => writeFile(file, text, { flag: "wx" }));
	} catch (e) {
		if (codeOf(e) !== "EEXIST") return unreadable(file, e);
	}
	return undefined;
};

// What ARCHITECTURE.md (Data locations) keeps out of git.
const GITIGNORE = "mete.db*\ncache/\nworktrees/\n";

const ensureWorkspaceFiles = async (metaDir: string) => {
	try {
		await withLockRetry(() => mkdir(metaDir, { recursive: true }));
	} catch (e) {
		return [unreadable(metaDir, e)];
	}
	const results = [
		await createOnce(
			join(metaDir, "workspace.yaml"),
			`id: ${crypto.randomUUID()}\n`,
		),
		await createOnce(join(metaDir, ".gitignore"), GITIGNORE),
	];
	return results.filter((r) => r !== undefined);
};

const readWorkspaceFiles = async (metaDir: string, errors: ConfigInvalid[]) => {
	let names: string[];
	try {
		names = await withLockRetry(() => readdir(metaDir));
	} catch (e) {
		errors.push(unreadable(metaDir, e));
		return {};
	}
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

/**
 * Loads global settings and `.mete/*.yaml`, creating `workspace.yaml` and `.gitignore` when missing.
 * `builtIn` are the composition root's default bindings; a capability the user binds replaces its default (docs/06).
 */
export const loadConfig = async (
	dirs: ConfigDirs,
	builtIn: z.output<typeof BindingsSchema> = {},
): Promise<Result<LoadedConfig, ReadonlyArray<ConfigInvalid>>> => {
	const metaDir = join(dirs.workspaceDir, ".mete");
	const setup = await ensureWorkspaceFiles(metaDir);
	// Without its own files the workspace has no id; later errors would only echo this.
	if (setup.length > 0) return err(setup);
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
		bindings: (ref) => map[ref] ?? builtIn[ref] ?? [],
		layers,
	});
};
