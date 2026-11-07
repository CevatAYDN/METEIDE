import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
	type McpDraft,
	type McpServerDraft,
	serversOf,
	serversText,
} from "../src/application/mcp-draft.js";

// The MCP servers card's file (ADR-097): a list of servers in .mete/mcp.yaml, or under mcp in the
// global settings.yaml, edited card by card without losing the file's comments or other sections.

const EMPTY: McpServerDraft = {
	id: "",
	transport: "",
	runtime: "",
	command: "",
	args: "",
	env: "",
	url: "",
	sha256: "",
	auth: "",
	permissions: [],
};

const server = (fields: Partial<McpServerDraft>): McpServerDraft => ({
	...EMPTY,
	...fields,
});

const draftOf = (text: string | undefined, target: "workspace" | "global") => {
	const r = serversOf(text, target);
	if (!r.ok) throw new Error(r.error);
	return r.value;
};

const textOf = (
	text: string | undefined,
	target: "workspace" | "global",
	servers: McpDraft,
) => {
	const r = serversText(text, target, servers);
	if (!r.ok) throw new Error(r.error);
	return r.value;
};

const reasonOf = (
	text: string | undefined,
	target: "workspace" | "global",
	servers: McpDraft,
) => {
	const r = serversText(text, target, servers);
	return r.ok ? "" : r.error;
};

const LOCAL = server({
	id: "blender",
	transport: "stdio",
	runtime: "python",
	command: "uvx",
	args: "blender-mcp==1.2.0",
	env: "BLENDER_HOST=127.0.0.1",
	permissions: ["fs.read"],
});

const REMOTE = server({
	id: "hf-spaces",
	transport: "streamable-http",
	url: "https://huggingface.co/mcp",
	auth: "oauth",
});

describe("serversOf", () => {
	it("reads this folder's servers as cards, with their arguments, environment and permissions", () => {
		expect(
			draftOf(
				"servers:\n  - id: blender\n    transport: stdio\n    runtime: python\n    command: uvx\n    args: [blender-mcp==1.2.0]\n    env: { BLENDER_HOST: 127.0.0.1 }\n    permissions: [fs.read]\n",
				"workspace",
			),
		).toEqual([LOCAL]);
	});

	it("reads the mcp section of the global settings file", () => {
		expect(
			draftOf(
				"gateway:\n  models: free\nmcp:\n  servers:\n    - id: hf-spaces\n      transport: streamable-http\n      url: https://huggingface.co/mcp\n      auth: oauth\n",
				"global",
			),
		).toEqual([REMOTE]);
	});

	it("sets no server for a missing file or section", () => {
		expect(draftOf(undefined, "workspace")).toEqual([]);
		expect(draftOf("gateway:\n  models: free\n", "global")).toEqual([]);
	});

	it("refuses a servers value that is not a list", () => {
		const r = serversOf("servers: nope\n", "workspace");
		expect(r.ok).toBe(false);
		expect(r.ok ? "" : r.error).toContain("expected a list of servers");
	});
});

describe("serversText", () => {
	it("refuses retained unsupported fields on unchanged and edited rows", () => {
		const before =
			"servers:\n  - id: demo\n    transport: sse\n    url: https://example.test\n    headers: { Authorization: secret }\n";
		for (const target of ["workspace", "global"] as const) {
			const source =
				target === "global"
					? `gateway: {}\nmcp:\n${before.replace(/^/gm, "  ")}`
					: before;
			const drafts = draftOf(source, target);
			expect(serversText(source, target, drafts).ok).toBe(false);
			expect(
				serversText(
					source,
					target,
					drafts.map((row) => ({ ...row, url: "https://changed.test" })),
				).ok,
			).toBe(false);
			expect(source).toContain("Authorization: secret");
		}
	});

	it("keeps row comments, unrelated rows and omitted defaults on an append", () => {
		const before =
			"# servers\nservers:\n  # keep me\n  - id: plain # identity\n    transport: sse\n    url: https://example.test # address\n";
		const out = textOf(before, "workspace", [
			...draftOf(before, "workspace"),
			LOCAL,
		]);
		expect(out).toContain("# keep me");
		expect(out).toContain("id: plain # identity");
		expect(out).toContain("url: https://example.test # address");
		expect(parse(out).servers[0]).not.toHaveProperty("auth");
		expect(parse(out).servers[0]).not.toHaveProperty("permissions");
	});

	it("keeps per-field comments and exact argv when editing a row", () => {
		const before =
			"servers:\n  - id: demo\n    transport: stdio\n    runtime: node\n    command: npx # runner\n    args: [old] # options\n";
		const drafts = draftOf(before, "workspace").map((row) => ({
			...row,
			args: " a b \n--next",
		}));
		const out = textOf(before, "workspace", drafts);
		expect(out).toContain("command: npx # runner");
		expect(out).toContain("# options");
		expect(parse(out).servers[0].args).toEqual([" a b ", "--next"]);
	});

	it("does not trim advanced environment values during another field edit", () => {
		const before =
			'servers:\n  - id: demo\n    transport: stdio\n    runtime: node\n    command: npx\n    env: { PADDED: " value " }\n';
		const out = textOf(
			before,
			"workspace",
			draftOf(before, "workspace").map((row) => ({
				...row,
				args: "package@1",
			})),
		);
		expect(parse(out).servers[0].env).toEqual({ PADDED: " value " });
	});

	it("keeps comments when renaming a server and leaves explicit defaults untouched on append", () => {
		const before =
			"servers:\n  # description\n  - id: plain # identity\n    transport: sse\n    url: https://example.test\n    auth: none # explicit choice\n";
		const renamed = textOf(
			before,
			"workspace",
			draftOf(before, "workspace").map((row) => ({ ...row, id: "renamed" })),
		);
		expect(renamed).toContain("# description");
		expect(renamed).toContain("id: renamed # identity");
		expect(renamed).toContain("auth: none # explicit choice");
		const appended = textOf(before, "workspace", [
			...draftOf(before, "workspace"),
			LOCAL,
		]);
		expect(appended).toContain("auth: none # explicit choice");
	});

	it("writes a local server with only the keys it sets, and keeps a comment", () => {
		const out = textOf("# my servers\nservers: []\n", "workspace", [LOCAL]);
		expect(out).toContain("# my servers");
		expect(parse(out)).toEqual({
			servers: [
				{
					id: "blender",
					transport: "stdio",
					runtime: "python",
					command: "uvx",
					args: ["blender-mcp==1.2.0"],
					env: { BLENDER_HOST: "127.0.0.1" },
					permissions: ["fs.read"],
				},
			],
		});
	});

	it("writes a remote server's sign-in only when it has one", () => {
		const out = textOf(undefined, "workspace", [
			REMOTE,
			server({ ...REMOTE, id: "plain", auth: "" }),
		]);
		const written = parse(out).servers as Record<string, unknown>[];
		expect(written[0]?.auth).toBe("oauth");
		expect(written[1]).not.toHaveProperty("auth");
	});

	it("writes a binary server's download and keeps the other shape's fields out of the file", () => {
		const binary = server({
			...LOCAL,
			runtime: "binary",
			url: "https://example.test/blender.zip",
			sha256: "a".repeat(64),
		});
		const [written] = parse(textOf(undefined, "workspace", [binary])).servers;
		expect(written).toMatchObject({
			url: "https://example.test/blender.zip",
			sha256: "a".repeat(64),
		});
		// A remote row that still holds a command writes none of it.
		const remote = parse(
			textOf(undefined, "workspace", [
				{ ...REMOTE, command: "uvx", env: "K=v" },
			]),
		).servers[0];
		expect(remote).not.toHaveProperty("command");
		expect(remote).not.toHaveProperty("env");
	});

	it("adds the mcp section to a global file that has other sections", () => {
		const out = textOf("gateway:\n  models: free\n", "global", [REMOTE]);
		expect(parse(out)).toEqual({
			gateway: { models: "free" },
			mcp: {
				servers: [
					{
						id: "hf-spaces",
						transport: "streamable-http",
						url: "https://huggingface.co/mcp",
						auth: "oauth",
					},
				],
			},
		});
	});

	it("removes the servers of a file the card emptied, and the mcp section with them", () => {
		expect(textOf("servers:\n  - id: blender\n", "workspace", [])).toBe("");
		expect(
			parse(
				textOf(
					"gateway:\n  models: free\nmcp:\n  servers:\n    - id: blender\n      transport: stdio\n      runtime: node\n      command: npx\n",
					"global",
					[],
				),
			),
		).toEqual({ gateway: { models: "free" } });
	});

	it("refuses a bad id, a missing command, a bad env line and the same id twice", () => {
		expect(
			reasonOf(undefined, "workspace", [
				server({ ...LOCAL, id: "Blender MCP" }),
			]),
		).toContain("expected a kebab-case server id");
		expect(
			reasonOf(undefined, "workspace", [server({ ...LOCAL, command: "" })]),
		).toContain("a local server needs a command");
		expect(
			reasonOf(undefined, "workspace", [
				server({ ...LOCAL, env: "BLENDER_HOST=127.0.0.1\nnope" }),
			]),
		).toContain("env line 2 needs Name=value");
		expect(
			reasonOf(undefined, "workspace", [LOCAL, { ...LOCAL, command: "other" }]),
		).toContain("server ids must be unique");
	});

	it("refuses a binary server without its download and a row with no shape yet", () => {
		expect(
			reasonOf(undefined, "workspace", [
				server({ ...LOCAL, runtime: "binary" }),
			]),
		).toContain("a binary server needs url and sha256");
		expect(reasonOf(undefined, "workspace", [EMPTY])).toContain(
			"server 1: a server needs an id",
		);
		expect(reasonOf(undefined, "workspace", [server({ id: "x" })])).toContain(
			"choose a transport",
		);
	});
});
