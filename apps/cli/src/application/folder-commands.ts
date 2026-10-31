import type { CommandCheckDirs } from "@mete/security";
import type { Io } from "./commands.js";
import { policyCommand } from "./policy.js";
import { vaultCommand } from "./vault.js";

// The commands that work on the folder's own files without starting the app: mete policy (ADR-167)
// and mete vault (ADR-173).

/** Runs `mete policy …` or `mete vault …` with the words after the command. */
export const folderCommand = (
	dirs: CommandCheckDirs,
	io: Io,
	[command, ...rest]: readonly string[],
	json: boolean,
) =>
	command === "vault"
		? vaultCommand(dirs.workspaceDir, io, rest)
		: policyCommand(dirs, io, rest, json);
