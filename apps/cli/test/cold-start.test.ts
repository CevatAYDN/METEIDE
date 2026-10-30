import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// docs/15, CLI cold start: every command imports @mete/mcp, so the MCP SDK must load only on first use.
// @mete/mcp's build is fresh here: turbo builds a package's dependencies before its tests (^build).
const PROGRAM = `
import { registerHooks } from "node:module";
const seen = [];
registerHooks({
	resolve(specifier, context, next) {
		if (specifier.startsWith("@modelcontextprotocol/")) seen.push(specifier);
		return next(specifier, context);
	},
});
await import("@mete/mcp");
console.log(JSON.stringify(seen));
`;

describe("the CLI's cold start", () => {
	it("loads no MCP SDK module when it imports @mete/mcp", () => {
		const child = spawnSync(
			process.execPath,
			["--input-type=module", "-e", PROGRAM],
			{ cwd: process.cwd(), encoding: "utf8" },
		);
		expect(child.stderr).toBe("");
		expect(JSON.parse(child.stdout)).toEqual([]);
	});
});
