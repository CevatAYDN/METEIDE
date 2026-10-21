import { release, type } from "node:os";
import { join } from "node:path";
import {
	err,
	ok,
	type Result,
	type ShellConfig,
	ShellExecInputSchema,
	type ShellExecOutput,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import { SHELL_TIMEOUT_SEC } from "../defaults.js";
import { blockedEnvKeys } from "../domain/env-rules.js";
import { kindOf } from "../infrastructure/files.js";
import { runProcess } from "../infrastructure/process.js";
import { type FsDeps, outside, parse, permit, place } from "./fs-common.js";

// shell.exec@1 (docs/10, Built-in tools).

export type ShellDeps = FsDeps & { readonly shell: ShellConfig };

// UTF-8 first, or Windows PowerShell garbles non-ASCII cmdlet output; the tail reports the
// last statement's result, since -Command alone gives 1 for any failed native command.
const PS_HEAD =
	"[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8\n";
const PS_TAIL =
	"\nif ($?) { exit 0 } elseif ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 }";

/** The program, arguments and shell name that run `command` on `platform`. */
export const shellCommand = (
	config: ShellConfig,
	command: string,
	platform = process.platform,
) => {
	if (platform !== "win32")
		return { file: "/bin/sh", args: ["-c", command], name: "sh" };
	if (config.windows === "git-bash" && config.gitBashPath)
		return {
			file: config.gitBashPath,
			args: ["-c", command],
			name: "Git Bash",
		};
	// An absolute path, so an `env` without PATH still finds it.
	const ps = join(
		process.env.SystemRoot ?? "C:Windows",
		"System32",
		"WindowsPowerShell",
		"v1.0",
		"powershell.exe",
	);
	const args = [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		PS_HEAD + command + PS_TAIL,
	];
	return { file: ps, args, name: "Windows PowerShell" };
};

/** The working folder: inside the boundary, existing and a folder. */
const workingDir = async (
	deps: FsDeps,
	path: string,
): Promise<Result<string, ToolError>> => {
	const p = await place(deps, path);
	if (!p.inside) return err(outside(path));
	const kind = await kindOf(p.real);
	if (!kind.ok) return kind;
	return kind.value === "folder"
		? ok(p.real)
		: err({ code: "bad_input", message: `${path} is a file, not a folder` });
};

export const shellTool = async (
	deps: ShellDeps,
	input: unknown,
	ctx: ToolContext,
): Promise<Result<ShellExecOutput, ToolError>> => {
	const i = parse(ShellExecInputSchema, input);
	if (!i.ok) return i;
	const blocked = blockedEnvKeys(i.value.env ?? {});
	if (blocked.length > 0)
		return err({
			code: "bad_input",
			message: `env may not set ${blocked.join(", ")}: they change which program runs`,
		});
	const cwd = await workingDir(deps, i.value.cwd ?? ".");
	if (!cwd.ok) return cwd;
	const { command } = i.value;
	const allowed = permit(
		deps,
		{
			action: "shell.exec",
			capability: "shell.exec@1",
			command,
			args: i.value,
		},
		ctx,
	);
	if (!allowed.ok) return allowed;
	const shell = shellCommand(deps.shell, command);
	const ran = await runProcess(
		{
			file: shell.file,
			args: shell.args,
			cwd: cwd.value,
			env: { ...process.env, ...i.value.env },
			timeoutMs: (i.value.timeoutSec ?? SHELL_TIMEOUT_SEC) * 1000,
		},
		ctx.signal,
	);
	return ran.ok
		? ok({ ...ran.value, os: `${type()} ${release()}`, shell: shell.name })
		: ran;
};
