import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpToolsAdapter } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { terminalAuthorize } from "../src/application/authorize.js";
import { createApp } from "../src/infrastructure/app.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

const signal = new AbortController().signal;
const URL_TO_OPEN = "https://auth.example/authorize?client_id=c1&state=s1";

describe("terminal sign-in", () => {
	it("shows the address to open and returns the address the user pasted", async () => {
		const t = recordingIo("", ["http://127.0.0.1/callback?code=c&state=s1"]);
		const pasted = await terminalAuthorize(t.io)("remote", URL_TO_OPEN, signal);
		expect(pasted).toBe("http://127.0.0.1/callback?code=c&state=s1");
		expect(t.out).toEqual([
			"MCP server remote needs you to sign in:",
			`  ${URL_TO_OPEN}`,
			"Open it, allow access, then paste the address your browser ends up on (it shows a connection error).",
		]);
		expect(t.prompts).toEqual(["Address: "]);
	});

	it("says why the last address was refused before asking again", async () => {
		const t = recordingIo("", ["http://127.0.0.1/callback?code=c&state=s1"]);
		await terminalAuthorize(t.io)(
			"remote",
			URL_TO_OPEN,
			signal,
			"the address does not belong to this sign-in",
		);
		expect(t.out).toEqual([
			"The last address was refused: the address does not belong to this sign-in",
			"MCP server remote needs you to sign in:",
			`  ${URL_TO_OPEN}`,
			"Open it, allow access, then paste the address your browser ends up on (it shows a connection error).",
		]);
	});

	it("says the server's tools are left out when the input ends instead of an address", async () => {
		const t = recordingIo("", [undefined]);
		expect(await terminalAuthorize(t.io)("remote", URL_TO_OPEN, signal)).toBe(
			undefined,
		);
		expect(t.out.at(-1)).toBe(
			"Not signed in: MCP server remote's tools are left out of this command.",
		);
	});

	it("gives nothing back, and prints nothing, without a terminal", async () => {
		const t = recordingIo();
		expect(await terminalAuthorize(t.io)("remote", URL_TO_OPEN, signal)).toBe(
			undefined,
		);
		expect(t.out).toEqual([]);
		expect(
			await terminalAuthorize(recordingIo("", [undefined]).io)(
				"r",
				URL_TO_OPEN,
				signal,
			),
		).toBe(undefined);
	});
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

// A remote server that wants a sign-in and the authorization server beside it; no MCP is spoken.
const fake: typeof fetch = async (input, init) => {
	const req = new Request(input, init);
	const { pathname } = new URL(req.url);
	if (pathname.startsWith("/.well-known/oauth-protected-resource"))
		return json({
			resource: "https://mcp.example/mcp",
			authorization_servers: ["https://mcp.example"],
		});
	if (pathname.startsWith("/.well-known/oauth-authorization-server"))
		return json({
			issuer: "https://mcp.example",
			authorization_endpoint: "https://mcp.example/authorize",
			token_endpoint: "https://mcp.example/token",
			registration_endpoint: "https://mcp.example/register",
			response_types_supported: ["code"],
			code_challenge_methods_supported: ["S256"],
		});
	if (pathname === "/register")
		return json({ ...(await req.json()), client_id: "client-1" }, 201);
	return new Response("", {
		status: 401,
		headers: {
			"WWW-Authenticate":
				'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"',
		},
	});
};

let close = async () => {};
afterEach(() => close());

describe("sign-in through the app", () => {
	it("asks in the terminal, says why an address is refused, and stops when the input ends", async () => {
		const mcp = `servers:
  - id: remote
    transport: streamable-http
    url: https://mcp.example/mcp
    auth: oauth
    permissions: []
`;
		const repo = await tempRepo({ "a.txt": "a\n" });
		await mkdir(join(repo.workspaceDir, ".mete"));
		await writeFile(join(repo.workspaceDir, ".mete", "mcp.yaml"), mcp);
		await writeFile(
			join(repo.workspaceDir, ".mete", "policy.yaml"),
			"autonomy: 3\n",
		);
		const t = recordingIo("", ["not an address"]);
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [],
			fetch: fake,
			authorize: terminalAuthorize(t.io),
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const r = app.value.registry.resolve<McpToolsAdapter>("mcp.tools@1");
		if (!r.ok) throw new Error("mcp.tools@1 is not active");
		const out = await r.value[0].impl.call(
			{ server: "remote", tool: "echo" },
			{ signal },
		);
		expect(out.ok === false && out.error.message).toMatch(
			/^MCP server remote: no sign-in was given/,
		);
		expect(t.out[0]).toBe("MCP server remote needs you to sign in:");
		expect(t.out[1]).toMatch(
			/^ {2}https:\/\/mcp\.example\/authorize\?.*client_id=client-1/,
		);
		// The refused address is asked for again at once, with why; the input then ends.
		expect(t.prompts).toEqual(["Address: ", "Address: "]);
		expect(t.out[3]).toMatch(
			/^The last address was refused: paste the whole address/,
		);
		expect(t.out.at(-1)).toBe(
			"Not signed in: MCP server remote's tools are left out of this command.",
		);
	});
});
