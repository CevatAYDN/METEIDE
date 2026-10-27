import type { AuditEntry } from "@mete/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	type AuditModel,
	AuditView,
	auditJson,
} from "../src/application/audit-view.js";

// The Audit log view rendered to HTML on Node, and the JSON its export writes.

const RUN = crypto.randomUUID();
const entry = (seq: number, verdict: AuditEntry["verdict"]): AuditEntry => ({
	seq,
	ts: "2026-10-23T10:00:00.000Z",
	runId: RUN,
	agentId: null,
	action: "fs.write",
	capability: "fs.edit@1",
	adapterId: "tools-fs",
	argsSha256: "a".repeat(64),
	verdict,
	rule: "autonomy:2:inside",
	tainted: false,
});
const html = (model: AuditModel, runs = [{ id: RUN, goal: "fix the typo" }]) =>
	renderToStaticMarkup(
		createElement(AuditView, {
			model,
			controls: {
				filter: { verdict: "allow" },
				runs,
				onFilter: () => {},
				onExport: () => {},
				onRefresh: () => {},
			},
		}),
	);

describe("the Audit log view", () => {
	it("lists each row's action, capability, verdict and rule, with the filters chosen", () => {
		const out = html({
			kind: "rows",
			entries: [entry(2, "allow"), entry(1, "allow")],
		});
		expect(out.match(/<tr>/g)).toHaveLength(3);
		expect(out).toContain(">fs.edit@1</td>");
		expect(out).toContain(">autonomy:2:inside</td>");
		expect(out).toContain('<option value="allow" selected="">allow</option>');
		expect(out).toContain(`<option value="${RUN}">fix the typo</option>`);
		expect(out).toContain('<option value="mcp.call">mcp.call</option>');
		expect(out).not.toMatch(/disabled=""><span[^>]*><\/span>Export/);
	});

	it("says no row matches, and offers no export of nothing", () => {
		const out = html({ kind: "rows", entries: [] });
		expect(out).toContain("No audit rows match these filters.");
		expect(out).toMatch(/disabled=""><span[^>]*><\/span>Export as JSON/);
	});

	it("says why the daemon gave no rows, or that a folder is needed", () => {
		expect(
			html({
				kind: "failed",
				failure: { code: "stopped", detail: "exit code 1" },
			}),
		).toContain('role="alert"');
		expect(html({ kind: "no_folder" })).toContain("Open a folder first");
	});

	it("exports the rows shown as JSON that reads back the same", () => {
		const rows = [entry(2, "deny"), entry(1, "allow")];
		expect(JSON.parse(auditJson(rows))).toEqual(rows);
		expect(auditJson(rows).endsWith("\n")).toBe(true);
	});
});
