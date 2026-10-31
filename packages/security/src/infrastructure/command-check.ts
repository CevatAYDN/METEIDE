import { homedir } from "node:os";
import {
	alwaysEntry,
	err,
	ok,
	type Policy,
	type PolicyVerdict,
	type Result,
} from "@mete/contracts";
import { decide } from "../domain/checker.js";
import { type PolicyDirs, readPolicy } from "./policy-source.js";

// mete policy check (ADR-167): what the policy decides for a command as a run of the folder would
// get it, untainted and without any run's grants. Nothing runs, so nothing is audited.

/** The decision, and the `shell.always` entry Always allow would write when it would turn the ask into allow. */
export type CommandVerdict = PolicyVerdict & { readonly always?: string };

/** The folders the policy is read from, and the OS facts of its path rules. */
export type CommandCheckDirs = PolicyDirs & {
	readonly home?: string;
	readonly platform?: NodeJS.Platform;
};

// Always writes shell.always (step 8), which an always_ask ask (step 7) comes before; `*` is refused (ADR-158).
const alwaysOf = (command: string, v: PolicyVerdict) =>
	v.verdict === "ask" && v.rule !== "always_ask" && !command.includes("*")
		? { always: alwaysEntry(command) }
		: {};

const policyOf = (dirs: PolicyDirs): Result<Policy, { message: string }> => {
	try {
		return ok(readPolicy(dirs));
	} catch (e) {
		return err({ message: e instanceof Error ? e.message : String(e) });
	}
};

/** Judges a command as a `shell.exec` call of `shell.exec@1`; a policy file that does not validate is an error. */
export const checkCommand = (
	dirs: CommandCheckDirs,
	command: string,
): Result<CommandVerdict, { readonly message: string }> => {
	const policy = policyOf(dirs);
	if (!policy.ok) return policy;
	const v = decide(
		{
			action: "shell.exec",
			capability: "shell.exec@1",
			adapterId: "policy-check", // decide does not read the adapter; only grants do
			args: { command },
			command,
		},
		{
			policy: policy.value,
			workspaceDir: dirs.workspaceDir,
			globalDir: dirs.globalDir,
			home: dirs.home ?? homedir(),
			platform: dirs.platform ?? process.platform,
		},
	);
	return ok({ ...v, ...alwaysOf(command, v) });
};
