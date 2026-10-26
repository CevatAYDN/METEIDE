import {
	type CapabilityRef,
	type CliMapping,
	type CliMappingEntry,
	err,
	ok,
	type Result,
	type ShellExecInput,
	type ShellExecOutput,
	type ToolAdapter,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import { render } from "../domain/render.js";
import { failed, inputOf, outputOf } from "./mapped.js";

// A level 2 cli mapping as an adapter of the capability it implements (ADR-120): the arguments
// render into one command line that runs through shell.exec@1 from the registry, in the task's
// folder, so the policy is asked for shell.exec with it; the output renders with `result` =
// { exitCode, stdout, stderr }.

export type ShellExec = ToolAdapter<ShellExecInput, ShellExecOutput>;

export type CliDeps = {
	readonly workspaceDir: string;
	readonly shell: () => ShellExec | undefined;
};

type Target = {
	readonly mapping: CliMapping;
	readonly ref: CapabilityRef;
	readonly entry: CliMappingEntry;
};

const PROGRAM = /^[\w.\-/:\\]+$/;
// What PowerShell or sh read inside double quotes: a quote (“ ” „ are quotes to PowerShell), an
// expansion, a line break, or a trailing \ that escapes sh's closing quote.
const UNSAFE = /["$`\r\n“”„]|\\$/;

const text = (v: unknown) =>
	v === undefined || v === null
		? ""
		: typeof v === "object"
			? undefined
			: String(v);

// shortcut: one quoted command line until a shell.exec@2 takes an argument list (ADR-120).
const commandLine = (
	command: string,
	args: readonly unknown[],
): Result<string, string> => {
	if (!PROGRAM.test(command))
		return err(
			`program ${JSON.stringify(command)} may hold only letters, digits, . _ - / : and \\`,
		);
	const words = [command];
	for (const [i, a] of args.entries()) {
		const word = text(a);
		if (word === undefined) return err(`argument ${i + 1} is not text`);
		if (UNSAFE.test(word))
			return err(
				`argument ${JSON.stringify(word)} holds a quote, $, a backtick, a line break or a trailing \\`,
			);
		words.push(`"${word}"`);
	}
	return ok(words.join(" "));
};

// The policy's deny and ask keep their code, so the run can pause on an ask.
const policyError = (e: ToolError) =>
	e.code === "denied" || e.code === "approval_required";

const exited = (line: string, out: ShellExecOutput) =>
	[
		`${line} ${out.timedOut ? "timed out" : `exited with ${out.exitCode}`}`,
		out.stdout,
		out.stderr,
	]
		.filter((s) => s.length > 0)
		.join("\n");

const run = async (
	deps: CliDeps,
	t: Target,
	raw: unknown,
	ctx: ToolContext,
): Promise<Result<unknown, ToolError>> => {
	const fail = failed(t);
	const input = inputOf(t.ref, raw);
	if (!input.ok) return input;
	const base = { input: input.value, workspace: { path: deps.workspaceDir } };
	const args = render(t.entry.args, base);
	if (!args.ok) return err(fail(`args ${args.error}`));
	const line = commandLine(
		t.entry.command,
		Array.isArray(args.value) ? args.value : [],
	);
	if (!line.ok) return err(fail(line.error));
	const shell = deps.shell();
	if (!shell) return err(fail("shell.exec@1 is not active"));
	const r = await shell.run({ command: line.value }, ctx);
	if (!r.ok) return policyError(r.error) ? r : err(fail(r.error.message));
	if (r.value.exitCode !== t.entry.success.exitCode)
		return err(fail(exited(line.value, r.value)));
	const { exitCode, stdout, stderr } = r.value;
	const result = { exitCode, stdout, stderr };
	const out = outputOf(t.ref, t.entry.output, { ...base, result });
	return out.ok ? out : err(fail(out.error));
};

/** The adapter for one `implements` entry of a cli mapping. */
export const cliAdapter = (
	deps: CliDeps,
	t: Target,
): ToolAdapter<unknown, unknown> => ({
	run: (input, ctx) => run(deps, t, input, ctx),
});
