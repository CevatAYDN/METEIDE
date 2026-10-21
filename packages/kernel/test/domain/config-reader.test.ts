import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	BindingsSchema,
	type ConfigLayers,
	createConfigReader,
} from "../../src/domain/config-reader.js";

const GLOBAL = "C:/Users/u/AppData/Roaming/METE/settings.yaml";
const MCP = "/repo/.mete/mcp.yaml";

const layers = (global: unknown, workspace?: unknown): ConfigLayers => ({
	global: { file: GLOBAL, sections: { mcp: global } },
	workspace:
		workspace === undefined ? {} : { mcp: { file: MCP, value: workspace } },
});

const McpSchema = z.object({
	servers: z.record(z.string(), z.object({ command: z.string() })).default({}),
	args: z.array(z.string()).default([]),
	timeoutSec: z.number().default(30),
});

describe("createConfigReader", () => {
	it("deep-merges the workspace file over the global section", () => {
		const reader = createConfigReader(
			layers(
				{ servers: { exa: { command: "npx" } }, timeoutSec: 10 },
				{ servers: { blender: { command: "uvx" } } },
			),
		);
		expect(reader.get("mcp", McpSchema)).toEqual({
			ok: true,
			value: {
				servers: { exa: { command: "npx" }, blender: { command: "uvx" } },
				args: [],
				timeoutSec: 10,
			},
		});
	});

	it("replaces arrays instead of merging them", () => {
		const reader = createConfigReader(
			layers({ args: ["a", "b"] }, { args: ["c"] }),
		);
		const r = reader.get("mcp", McpSchema);
		expect(r.ok && r.value.args).toEqual(["c"]);
	});

	it("fills built-in defaults from the schema when no file sets them", () => {
		const reader = createConfigReader(layers(undefined, {}));
		const r = reader.get("mcp", McpSchema);
		expect(r.ok && r.value.timeoutSec).toBe(30);
	});

	it("names the workspace file and path of a bad workspace value", () => {
		const reader = createConfigReader(layers({}, { timeoutSec: "soon" }));
		const r = reader.get("mcp", McpSchema);
		expect(r.ok ? undefined : r.error).toMatchObject({
			code: "config_invalid",
			file: MCP,
			path: "timeoutSec",
		});
	});

	it("names the global file and section path of a bad global value", () => {
		const reader = createConfigReader(
			layers({ servers: { exa: { command: 1 } } }, {}),
		);
		const r = reader.get("mcp", McpSchema);
		expect(r.ok ? undefined : r.error).toMatchObject({
			file: GLOBAL,
			path: "mcp.servers.exa.command",
		});
	});

	it("names the file whose array holds a bad item, since arrays replace", () => {
		const fromWorkspace = createConfigReader(
			layers({ args: ["a"] }, { args: ["b", 2] }),
		).get("mcp", McpSchema);
		expect(fromWorkspace.ok ? undefined : fromWorkspace.error).toMatchObject({
			file: MCP,
			path: "args.1",
		});
		const fromGlobal = createConfigReader(layers({ args: [1] }, {})).get(
			"mcp",
			McpSchema,
		);
		expect(fromGlobal.ok ? undefined : fromGlobal.error).toMatchObject({
			file: GLOBAL,
			path: "mcp.args.0",
		});
	});

	it("names the workspace file for a key missing inside a workspace array item", () => {
		const Schema = z.object({
			items: z.array(z.object({ name: z.string() })).default([]),
		});
		const r = createConfigReader(layers({}, { items: [{}] })).get(
			"mcp",
			Schema,
		);
		expect(r.ok ? undefined : r.error).toMatchObject({
			file: MCP,
			path: "items.0.name",
		});
	});

	it("names the file that holds the most of a missing key's path", () => {
		const Schema = z.object({
			servers: z.record(
				z.string(),
				z.object({ command: z.string(), cwd: z.string() }),
			),
		});
		const inWorkspace = createConfigReader(
			layers({}, { servers: { exa: { command: "npx" } } }),
		).get("mcp", Schema);
		expect(inWorkspace.ok ? undefined : inWorkspace.error).toMatchObject({
			file: MCP,
			path: "servers.exa.cwd",
		});
		const inGlobal = createConfigReader(
			layers({ servers: { exa: { command: "npx" } } }, { servers: {} }),
		).get("mcp", Schema);
		expect(inGlobal.ok ? undefined : inGlobal.error).toMatchObject({
			file: GLOBAL,
			path: "mcp.servers.exa.cwd",
		});
	});
});

describe("BindingsSchema", () => {
	it("accepts capability ids mapped to adapter ids", () => {
		const r = BindingsSchema.safeParse({
			"web.search@1": ["exa-mcp", "tavily"],
		});
		expect(r.success).toBe(true);
	});

	it("rejects a key that is not a capability id", () => {
		expect(
			BindingsSchema.safeParse({ "web-search": ["exa-mcp"] }).success,
		).toBe(false);
	});
});
