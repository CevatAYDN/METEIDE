import { type McpServer, ok } from "@mete/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { McpCard } from "../src/application/mcp-card.js";
import {
	serverDraftOf,
	serversOf,
	serversText,
} from "../src/application/mcp-draft.js";
import { ToolCatalog } from "../src/application/tool-catalog.js";
import { ToolCatalogView } from "../src/application/tool-catalog-view.js";

const field = {
	kind: "env" as const,
	name: "METE_TEST_KEY",
	required: true,
	secret: true,
};
const server: McpServer = {
	id: "fixture",
	transport: "stdio",
	runtime: "node",
	command: "fixture",
	args: [],
	permissions: [],
	credentialFields: [field],
};
const setup = {
	server,
	source: "https://registry.example.test/fixture",
	notes: ["Set METE_TEST_KEY"],
	fields: [field],
	blocked: false,
};

describe("structured MCP setup integration", () => {
	it.each(["workspace", "global"] as const)(
		"retains metadata without values in %s YAML",
		(scope) => {
			const result = serversText(undefined, scope, [serverDraftOf(server)]);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const doc = parse(result.value);
			expect(
				(scope === "global" ? doc.mcp : doc).servers[0].credentialFields,
			).toEqual([field]);
			const loaded = serversOf(result.value, scope);
			expect(loaded.ok && loaded.value[0]?.credentialFields).toEqual([field]);
			expect(result.value).not.toContain("values:");
			expect(result.value).not.toContain("env:");
		},
	);
	it("refuses malformed credential metadata rather than silently dropping it", () => {
		const result = serversText(undefined, "workspace", [
			serverDraftOf({
				...server,
				credentialFields: [{ ...field, value: "SECRET_SENTINEL" }],
			}),
		]);
		expect(result.ok).toBe(false);
	});
	it("allows a supported required-field draft, but does not connect or write secrets", async () => {
		const add = vi.fn((_server: McpServer) => true);
		const catalog = new ToolCatalog({
			search: async () => ok({ entries: [] }),
			prepare: async () => ok(setup),
			add,
			onChange: () => {},
		});
		await catalog.prepare("fixture");
		const out = renderToStaticMarkup(
			createElement(ToolCatalogView, { catalog }),
		);
		expect(out).toContain("METE_TEST_KEY");
		expect(out).toContain("Setup required");
		catalog.add();
		expect(add).toHaveBeenCalledWith(server);
	});
	it("prevents adding blocked structured drafts while retaining their notes", async () => {
		const add = vi.fn((_server: McpServer) => true);
		const catalog = new ToolCatalog({
			search: async () => ok({ entries: [] }),
			prepare: async () => ok({ ...setup, blocked: true }),
			add,
			onChange: () => {},
		});
		await catalog.prepare("fixture");
		catalog.add();
		expect(add).not.toHaveBeenCalled();
		expect(catalog.state.draft?.notes).toEqual(setup.notes);
	});
	it("renders connection requirements and disables Connect, while permitting config save", () => {
		const out = renderToStaticMarkup(
			createElement(McpCard, {
				state: {
					target: "workspace",
					servers: [serverDraftOf(server)],
					busy: false,
					dirty: false,
				},
				actions: {
					onAdd: () => {},
					onField: () => {},
					onPermission: () => {},
					onRemove: () => {},
					onSaveConnect: () => {},
				},
				tests: { stateOf: () => ({ kind: "idle" as const }), onTest: () => {} },
				connection: {
					render: () => createElement("span", null, "Credentials required"),
					blocked: () => true,
				},
			}),
		);
		expect(out).toContain("Credentials required");
		expect(out).toMatch(/id="mete-mcp-0-test"[^>]*disabled/);
		expect(out).not.toContain("Not tested");
	});
});
