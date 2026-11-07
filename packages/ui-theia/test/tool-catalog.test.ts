import { type McpServer, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { ToolCatalog } from "../src/application/tool-catalog.js";

const draft = {
	source: "org.example/docs",
	server: {
		id: "docs",
		transport: "streamable-http" as const,
		auth: "none" as const,
		url: "https://example.org/mcp",
		permissions: [],
	},
	notes: [],
};
const ports = () => ({
	search: vi.fn(async () => ok({ entries: [] })),
	prepare: vi.fn(async () => ok(draft)),
	add: vi.fn((_server: McpServer) => true),
	onChange: vi.fn(),
});

describe("tool catalog drafts", () => {
	it("keeps unresolved requirements visible and does not add an unconfigured draft", async () => {
		const deps = {
			...ports(),
			prepare: vi.fn(async () => ok({ ...draft, notes: ["API_KEY required"] })),
		};
		const catalog = new ToolCatalog(deps);
		await catalog.prepare("org.example/docs");
		catalog.add();
		expect(deps.add).not.toHaveBeenCalled();
		expect(catalog.state.draft?.notes).toEqual(["API_KEY required"]);
	});
	it("has no startup network request and never saves or connects on preparation", async () => {
		const deps = ports();
		const catalog = new ToolCatalog(deps);
		expect(deps.search).not.toHaveBeenCalled();
		await catalog.prepare("org.example/docs");
		expect(catalog.state.draft).toEqual(draft);
		expect(deps.add).not.toHaveBeenCalled();
		catalog.add();
		expect(deps.add).toHaveBeenCalledWith(draft.server);
		expect(catalog.state.draft).toBeUndefined();
	});
	it("keeps a failed duplicate draft review visible", async () => {
		const deps = ports();
		deps.add.mockReturnValue(false);
		const catalog = new ToolCatalog(deps);
		await catalog.prepare("org.example/docs");
		catalog.add();
		expect(catalog.state.draft).toEqual(draft);
		expect(catalog.state.error).toBeTruthy();
	});
	it("ignores results arriving after scope or workspace reset", async () => {
		let finish = (_value: ReturnType<typeof ok<{ entries: [] }>>) => {};
		const deps = {
			...ports(),
			search: () =>
				new Promise<ReturnType<typeof ok<{ entries: [] }>>>((resolve) => {
					finish = resolve;
				}),
		};
		const catalog = new ToolCatalog(deps);
		catalog.query("docs");
		const request = catalog.search();
		catalog.reset();
		finish(ok({ entries: [] }));
		await request;
		expect(catalog.state).toEqual({ query: "", busy: false });
	});
});
