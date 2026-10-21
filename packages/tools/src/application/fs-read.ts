import { join, relative, sep } from "node:path";
import {
	err,
	FsGlobInputSchema,
	FsGrepInputSchema,
	type FsGrepOutput,
	FsListInputSchema,
	type FsPathsOutput,
	FsReadInputSchema,
	type FsReadOutput,
	ok,
	type Result,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import { GREP_MAX_RESULTS } from "../defaults.js";
import { shown } from "../domain/paths.js";
import { isBinary, lineEnding, sliceLines } from "../domain/text.js";
import { kindOf, readBytes } from "../infrastructure/files.js";
import { grepLines, listFiles } from "../infrastructure/ripgrep.js";
import {
	type FsDeps,
	ignoredError,
	outside,
	parse,
	place,
	rules,
} from "./fs-common.js";

// fs.read@1, fs.list@1, fs.glob@1 and fs.grep@1 (docs/10, Built-in tools).

type Out<T> = Promise<Result<T, ToolError>>;

export const readFileTool = async (
	deps: FsDeps,
	input: unknown,
): Out<FsReadOutput> => {
	const i = parse(FsReadInputSchema, input);
	if (!i.ok) return i;
	const p = await place(deps, i.value.path);
	if (!p.inside) return err(outside(i.value.path));
	const ignored = await rules(deps);
	if (!ignored.ok) return ignored;
	if (ignored.value(p.real)) return err(ignoredError(i.value.path));
	const bytes = await readBytes(p.real);
	if (!bytes.ok) return bytes;
	if (isBinary(bytes.value))
		return err({ code: "binary", message: `${i.value.path} is a binary file` });
	const text = bytes.value.toString("utf8");
	const lines = sliceLines(text, i.value.startLine, i.value.endLine);
	return ok({ ...lines, lineEnding: lineEnding(text) });
};

/** The folder to list from: inside the boundary, existing, a folder and not ignored. */
const folderAt = async (deps: FsDeps, path: string) => {
	const p = await place(deps, path);
	if (!p.inside) return err(outside(path));
	const kind = await kindOf(p.real);
	if (!kind.ok) return kind;
	if (kind.value === "file")
		return err<ToolError>({
			code: "bad_input",
			message: `${path} is a file, not a folder`,
		});
	const ignored = await rules(deps);
	if (!ignored.ok) return ignored;
	if (ignored.value(p.real, true)) return err(ignoredError(path));
	const sub = relative(p.root, p.real);
	return ok({
		...p,
		sub,
		keep: (rel: string) => !ignored.value(join(p.root, rel)),
	});
};

/** Children of a folder; a folder shows when it holds a listed file. */
export const listTool = async (
	deps: FsDeps,
	input: unknown,
	ctx: ToolContext,
): Out<FsPathsOutput> => {
	const i = parse(FsListInputSchema, input);
	if (!i.ok) return i;
	const at = await folderAt(deps, i.value.path);
	if (!at.ok) return at;
	const sub = at.value.sub === "" ? {} : { sub: at.value.sub };
	const files = await listFiles(at.value.root, sub, ctx.signal, at.value.keep);
	if (!files.ok) return files;
	const children = new Set<string>();
	for (const rel of files.value) {
		const [head, ...rest] = relative(
			at.value.real,
			join(at.value.root, rel),
		).split(sep);
		children.add(
			shown(deps.workspaceDir, join(at.value.real, head ?? "")) +
				(rest.length > 0 ? "/" : ""),
		);
	}
	return ok({ paths: [...children].sort() });
};

export const globTool = async (
	deps: FsDeps,
	input: unknown,
	ctx: ToolContext,
): Out<FsPathsOutput> => {
	const i = parse(FsGlobInputSchema, input);
	if (!i.ok) return i;
	const at = await folderAt(deps, i.value.path ?? ".");
	if (!at.ok) return at;
	const query = {
		glob: i.value.pattern,
		...(at.value.sub === "" ? {} : { sub: at.value.sub }),
	};
	const files = await listFiles(
		at.value.root,
		query,
		ctx.signal,
		at.value.keep,
	);
	if (!files.ok) return files;
	return ok({
		paths: files.value.map((rel) =>
			shown(deps.workspaceDir, join(at.value.root, rel)),
		),
	});
};

export const grepTool = async (
	deps: FsDeps,
	input: unknown,
	ctx: ToolContext,
): Out<FsGrepOutput> => {
	const i = parse(FsGrepInputSchema, input);
	if (!i.ok) return i;
	const ignored = await rules(deps);
	if (!ignored.ok) return ignored;
	const { pattern, glob, caseSensitive, maxResults } = i.value;
	const query = {
		pattern,
		caseSensitive: caseSensitive ?? true,
		max: maxResults ?? GREP_MAX_RESULTS,
	};
	return grepLines(
		deps.workspaceDir,
		glob === undefined ? query : { ...query, glob },
		ctx.signal,
		(rel) => !ignored.value(join(deps.workspaceDir, rel)),
	);
};
