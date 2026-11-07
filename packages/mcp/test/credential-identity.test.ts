import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServerSchema } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { credentialIdentity } from "../src/infrastructure/credential-identity.js";

const remote = McpServerSchema.parse({
	id: "remote",
	transport: "streamable-http",
	url: "https://example.test/mcp",
});
describe("target-bound credential identity", () => {
	it("does not share origin credentials across path, id or configuration changes", async () => {
		const first = await credentialIdentity(tmpdir(), remote);
		expect(first.ok).toBe(true);
		for (const patch of [
			{ id: "renamed" },
			{ url: "https://example.test/other" },
			{ auth: "oauth" },
		]) {
			const changed = McpServerSchema.parse({ ...remote, ...patch });
			expect(await credentialIdentity(tmpdir(), changed)).not.toEqual(first);
		}
	});
	it("normalizes object key order but preserves command arguments", async () => {
		const server = {
			id: "local",
			transport: "stdio",
			runtime: "node",
			command: "node",
		};
		const a = McpServerSchema.parse({
			...server,
			env: { A: "a", B: "b" },
			args: ["a", "b"],
		});
		const b = McpServerSchema.parse({
			...server,
			env: { B: "b", A: "a" },
			args: ["a", "b"],
		});
		expect(await credentialIdentity(tmpdir(), a)).toEqual(
			await credentialIdentity(tmpdir(), b),
		);
		expect(await credentialIdentity(tmpdir(), a)).not.toEqual(
			await credentialIdentity(
				tmpdir(),
				McpServerSchema.parse({ ...b, args: ["b", "a"] }),
			),
		);
	});
	it("refuses an unavailable workspace rather than falling back to a shared identity", async () => {
		expect(
			(
				await credentialIdentity(
					join(tmpdir(), "mete-missing-identity-184"),
					remote,
				)
			).ok,
		).toBe(false);
	});
});
