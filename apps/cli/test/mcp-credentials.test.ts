import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

describe("write-only MCP credential command", () => {
	it("requires an exact saved target, receives values only through stdin and never prints them", async () => {
		const repo = await tempRepo({ "readme.txt": "fixture" });
		const expected = {
			id: "remote",
			transport: "streamable-http",
			url: "https://example.test/mcp",
			auth: "none",
			permissions: [],
		};
		try {
			await mkdir(join(repo.workspaceDir, ".mete"), { recursive: true });
			await writeFile(
				join(repo.workspaceDir, ".mete", "mcp.yaml"),
				JSON.stringify({ servers: [expected] }),
			);
			const body = {
				expected,
				fields: [
					{ kind: "header", name: "X-Key", required: true, secret: true },
				],
				values: { "header:X-Key": "private-sentinel" },
			};
			const recording = recordingIo(JSON.stringify(body));
			const env = {
				cwd: repo.workspaceDir,
				globalDir: repo.globalDir,
				logger: silent,
				secrets: memorySecrets(),
			};
			expect(
				await main(["mcp-key", "set", repo.workspaceDir], recording.io, env),
			).toBe(0);
			expect([...recording.out, ...recording.err].join(" ")).not.toContain(
				"private-sentinel",
			);
			const changed = recordingIo(
				JSON.stringify({
					...body,
					expected: { ...expected, url: "https://other.test/mcp" },
				}),
			);
			expect(
				await main(["mcp-key", "set", repo.workspaceDir], changed.io, env),
			).toBe(1);
			expect([...changed.out, ...changed.err].join(" ")).not.toContain(
				"private-sentinel",
			);
		} finally {
			await repo.close();
		}
	});
});
