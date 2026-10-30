import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The end-to-end suite against the packaged app (docs/15, ADR-124): `pnpm --filter @mete/desktop
// package:win` first, then this. The app under test is chosen by METE_E2E_APP (e2e/app.ts), and the
// variable is set here because a Windows shell cannot prefix a command with VAR=value as POSIX does.

const app = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = createRequire(join(app, "package.json")).resolve(
	"@playwright/test/cli",
);

// Onboarding, the runs of run-flow (reading the workspace, calling an MCP server) and the MCP card's
// Test (the MCP SDK loads on first use, ADR-164): flows a package can break on its own.
const result = spawnSync(
	process.execPath,
	[
		cli,
		"test",
		"e2e/onboarding.e2e.ts",
		"e2e/run-flow.e2e.ts",
		"e2e/settings-mcp.e2e.ts",
	],
	{
		cwd: app,
		stdio: "inherit",
		env: { ...process.env, METE_E2E_APP: "packaged" },
	},
);
process.exit(result.status ?? 1);
