import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type McpActions, McpCard } from "../src/application/mcp-card.js";
import { EMPTY_MCP_SERVER } from "../src/application/mcp-draft.js";
import { McpConnectionStatus } from "../src/application/mcp-test.js";
import { ToolSetupFields } from "../src/application/tool-setup-fields.js";

const none = () => {};
const actions: McpActions = {
	onField: none,
	onPermission: none,
	onAdd: none,
	onRemove: none,
};

describe("the guided tool surface", () => {
	it("offers one connection action with draft, pending and failure recovery", () => {
		const html = (kind: "idle" | "saved_pending" | "failed", dirty = false) =>
			renderToStaticMarkup(
				createElement(McpCard, {
					state: {
						target: "workspace",
						servers: [{ ...EMPTY_MCP_SERVER, id: "demo" }],
						dirty,
						busy: false,
					},
					actions: { ...actions, onSaveConnect: none },
					tests: {
						stateOf: () =>
							kind === "failed"
								? { kind, text: "Connection refused" }
								: { kind },
						onTest: none,
					},
				}),
			);
		for (const [kind, dirty, label] of [
			["idle", true, "Save and connect"],
			["saved_pending", false, "Connect"],
			["failed", false, "Retry connection"],
		] as const) {
			const out = html(kind, dirty);
			expect(out).toContain(label);
			expect(out.match(/id="mete-mcp-0-test"/g)).toHaveLength(1);
			expect(out).not.toMatch(/>Test<\/button>/);
			expect(out).not.toContain("disabled");
		}
		expect(html("failed")).toContain("Connection refused");
	});

	it("starts with compact rows and closed advanced configuration, without connecting", () => {
		let connections = 0;
		const html = renderToStaticMarkup(
			createElement(McpCard, {
				state: {
					target: "workspace",
					servers: [
						{
							...EMPTY_MCP_SERVER,
							id: "demo",
							transport: "sse",
							url: "https://example.test",
						},
					],
					dirty: false,
					busy: false,
				},
				actions: {
					...actions,
					onConnect: () => {
						connections++;
					},
					onCatalog: none,
				},
				tests: { stateOf: () => ({ kind: "idle" as const }), onTest: none },
				catalog: createElement("span", null, "Catalog content"),
			}),
		);
		expect(html).toContain('class="mete-tool-row"');
		expect(html).toContain("<summary>Advanced");
		expect(html).not.toContain("<details open");
		expect(html).toContain("Not tested");
		expect(html).toContain("Add server");
		expect(html).toContain("Browse catalog");
		expect(html).toContain("Catalog content");
		expect(html).not.toContain("Test connects to a server");
		expect(connections).toBe(0);
	});

	it("labels required fields and associates errors with their input", () => {
		const html = renderToStaticMarkup(
			createElement(ToolSetupFields, {
				input: { mode: "remote", id: "", url: "" },
				onChange: none,
				error: {
					code: "invalid_setup",
					field: "url",
					text: "Enter an address",
				},
			}),
		);
		expect(html).toContain("Remote URL");
		expect(html).toContain('required=""');
		expect(html).toContain('aria-invalid="true"');
		expect(html).toContain('aria-describedby="mete-tool-setup-url-error"');
		expect(html).toContain('role="alert"');
		expect(html).toContain('value="" selected=""');
	});

	it("never labels an unsaved or pending server connected", () => {
		const state = {
			kind: "done" as const,
			answer: { id: "demo", ok: true as const, tools: [], ms: 1 },
		};
		const html = (dirty: boolean) =>
			renderToStaticMarkup(
				createElement(McpConnectionStatus, { state, dirty }),
			);
		expect(html(false)).toContain("Connected");
		expect(html(true)).toContain("Unsaved changes");
		expect(html(true)).not.toContain("Connected");
		const pending = renderToStaticMarkup(
			createElement(McpConnectionStatus, { state: { kind: "saved_pending" } }),
		);
		expect(pending).toContain("Saved; pending activation");
	});
});
