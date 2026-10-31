import { type CommandCheckDirs, checkCommand } from "@mete/security";
import { usage } from "../usage.js";
import type { Io } from "./commands.js";

// `mete policy check "<command>"` (ADR-167): what the folder's policy decides for a command as a run
// would get it, without running it, untainted and without any run's grants; no audit row.

const EXIT = { allow: 0, ask: 2, deny: 1 } as const;

// Why Always allow would not turn this ask into allow (SECURITY.md decision order, ADR-158).
const notAlways = (rule: string) =>
	rule === "always_ask"
		? "Always allow would not help: shell.exec is in always_ask, which comes before shell.always."
		: "Always allow would not help: a command with * cannot be allowed for good.";

/** Prints the verdict and the rule; exits 0 allow, 2 ask, 1 deny or a policy file that does not validate. */
export const policyCommand = (
	dirs: CommandCheckDirs,
	io: Io,
	[sub, ...words]: readonly string[],
	json: boolean,
) => {
	const command = words.join(" ").trim();
	if (sub !== "check" || !command) return usage(io);
	const r = checkCommand(dirs, command);
	if (!r.ok) {
		io.err(r.error.message);
		return 1;
	}
	const v = r.value;
	if (json) io.out(JSON.stringify(v, null, 2));
	else {
		io.out(`${v.verdict}  ${v.rule}`);
		if (v.verdict === "ask")
			io.out(
				v.always
					? `Always allow would add to shell.always: ${v.always}`
					: notAlways(v.rule),
			);
	}
	return EXIT[v.verdict];
};
