import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const CliManifest = z.object({ bin: z.object({ mete: z.string().min(1) }) });

// The `mete` entry file of the installed @mete/cli package. The backend is bundled into
// apps/desktop/lib/backend, so the lookup starts there and apps/desktop depends on @mete/cli too.
const cliBin = () => {
	const manifest = require.resolve("@mete/cli/package.json");
	const { bin } = CliManifest.parse(JSON.parse(readFileSync(manifest, "utf8")));
	return join(dirname(manifest), bin.mete);
};

/**
 * Starts `mete daemon <folder>` on the Node of this process; inside Electron that is Electron's
 * own Node, which ELECTRON_RUN_AS_NODE asks for (ARCHITECTURE.md, Daemon protocol).
 */
export const spawnCli = (workspaceDir: string) =>
	spawn(process.execPath, [cliBin(), "daemon", workspaceDir], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
