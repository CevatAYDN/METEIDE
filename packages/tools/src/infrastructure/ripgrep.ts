import { createInterface } from "node:readline";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { rgPath } from "@vscode/ripgrep";
import { z } from "zod";
import { spawnPiped } from "./process.js";

// ripgrep for fs.list@1, fs.glob@1 and fs.grep@1 (docs/05 Grep, docs/10 Built-in tools).
// It applies .gitignore itself; callers drop `.meteignore` paths with `keep` (ADR-040).

// --no-require-git: .gitignore counts outside a repository too; --no-ignore-parent: but
// only inside the searched root, so a .gitignore above the workspace hides nothing.
const BASE = [
	"--hidden",
	"--no-require-git",
	"--no-ignore-parent",
	"--glob",
	"!.git",
];

const posix = (p: string) => p.replaceAll("\\", "/");

/** Runs rg in `cwd` and feeds each stdout line to `each` until it returns false. */
const rgLines = (
	args: readonly string[],
	cwd: string,
	signal: AbortSignal,
	each: (line: string) => boolean,
): Promise<Result<void, ToolError>> =>
	new Promise((done) => {
		// stdin "ignore": without a path rg would otherwise search a piped stdin.
		const started = spawnPiped(rgPath, [...BASE, ...args], { cwd, signal });
		if (!started.ok) return done(started);
		const child = started.value;
		let stopped = false;
		let stderr = "";
		child.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		createInterface({ input: child.stdout }).on("line", (line) => {
			if (stopped || each(line)) return;
			stopped = true;
			child.kill();
		});
		child.on("error", (e) => {
			if (!stopped) done(err({ code: "io", message: `ripgrep: ${e.message}` }));
			stopped = true;
		});
		child.on("close", (code) => {
			if (stopped || code === 0 || code === 1) return done(ok(undefined));
			const message = `ripgrep exited ${code}: ${stderr.trim()}`;
			const bad = stderr.includes("regex parse error");
			done(err({ code: bad ? "bad_input" : "io", message }));
		});
	});

/** Files under `sub` (relative to `cwd`) matching `glob`, as sorted "/" paths relative to `cwd`. */
export const listFiles = async (
	cwd: string,
	query: { readonly sub?: string; readonly glob?: string },
	signal: AbortSignal,
	keep: (rel: string) => boolean,
): Promise<Result<string[], ToolError>> => {
	const paths: string[] = [];
	const args = ["--files", "--sort", "path"];
	if (query.glob) args.push("--glob", query.glob);
	if (query.sub) args.push("--", query.sub);
	const r = await rgLines(args, cwd, signal, (line) => {
		const rel = posix(line);
		if (keep(rel)) paths.push(rel);
		return true;
	});
	return r.ok ? ok(paths) : r;
};

const parseJson = (line: string): unknown => {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
};

const MatchLine = z.object({
	type: z.literal("match"),
	data: z.object({
		path: z.object({ text: z.string() }),
		line_number: z.number(),
		lines: z.object({ text: z.string() }),
	}),
});

export type GrepMatch = { path: string; line: number; text: string };

/** Lines matching `pattern` in `cwd`, at most `max`; `truncated` when more existed. */
export const grepLines = async (
	cwd: string,
	query: {
		pattern: string;
		glob?: string;
		caseSensitive: boolean;
		max: number;
	},
	signal: AbortSignal,
	keep: (rel: string) => boolean,
): Promise<Result<{ matches: GrepMatch[]; truncated: boolean }, ToolError>> => {
	const matches: GrepMatch[] = [];
	let truncated = false;
	// --sort path keeps the results and the cut at `max` the same on every run.
	const args = ["--json", "--sort", "path"];
	args.push(query.caseSensitive ? "--case-sensitive" : "--ignore-case");
	if (query.glob) args.push("--glob", query.glob);
	args.push("--regexp", query.pattern);
	const r = await rgLines(args, cwd, signal, (line) => {
		const m = MatchLine.safeParse(parseJson(line));
		if (!m.success) return true;
		const { path, line_number, lines } = m.data.data;
		if (!keep(posix(path.text))) return true;
		if (matches.length === query.max) {
			truncated = true;
			return false;
		}
		const text = lines.text.replace(/\r?\n$/, "");
		matches.push({ path: posix(path.text), line: line_number, text });
		return true;
	});
	return r.ok ? ok({ matches, truncated }) : r;
};
