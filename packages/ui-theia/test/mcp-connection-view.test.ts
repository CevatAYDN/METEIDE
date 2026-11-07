import type { McpConnectionState, McpCredentialField } from "@mete/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { McpConnectionViewState } from "../src/application/mcp-connection-session.js";
import { McpConnectionView } from "../src/application/mcp-connection-view.js";

const field: McpCredentialField = {
	kind: "header",
	name: "X-Key",
	required: true,
	secret: true,
};
const state = (phase: McpConnectionState["phase"]): McpConnectionViewState => ({
	busy: false,
	dirty: false,
	values: {},
	error: undefined,
	fields: [field],
	connection: {
		id: "docs",
		identity: "a".repeat(64),
		phase,
		fields: [{ ...field, configured: false }],
	},
});
const html = (value: McpConnectionViewState, extra: object = {}) =>
	renderToStaticMarkup(
		createElement(McpConnectionView, {
			id: "docs",
			state: value,
			oauth: true,
			disabled: false,
			onType: () => {},
			onRun: () => {},
			onSave: () => {},
			onAdd: () => {},
			...extra,
		}),
	);

describe("compact MCP connection controls", () => {
	it("labels secret fields and preserves write-only empty password inputs", () => {
		const out = html(state("needs_credentials"));
		expect(out).toContain('type="password"');
		expect(out).toContain('autoComplete="off"');
		expect(out).toContain('value=""');
		expect(out).toContain("X-Key");
		expect(out).toContain('required=""');
		expect(out).toContain("Credentials required");
		expect(out).not.toContain("Connected");
	});
	it.each([
		"configured",
		"untested",
		"cancelled",
		"expired",
		"failed",
	] as const)("does not claim handshake success for %s", (phase) => {
		expect(html(state(phase))).not.toContain(">Connected<");
	});
	it("offers captured cancellation while pending and marks errors accessibly", () => {
		expect(html(state("pending"))).toContain("Cancel sign-in");
		const out = html({ ...state("failed"), error: "required" });
		expect(out).toContain('role="alert"');
		expect(out).toContain('aria-invalid="true"');
		expect(out).toContain('aria-describedby="docs-credentials-error"');
		expect(out).toContain("Enter every required value");
	});
	it("offers explicit sign-in and distinguishes local cleanup from revocation", () => {
		const out = html(state("needs_sign_in"));
		expect(out).toContain("Sign in");
		expect(out).toContain("Forget local credentials");
		expect(out).toContain("does not revoke");
		expect(out).toContain("codicon");
	});
	it("keeps local tool rows free of remote-account cleanup copy", () => {
		const out = html(state("needs_credentials"), { oauth: false });
		expect(out).not.toContain("remote account");
		expect(out).not.toContain("does not revoke");
		expect(out).toContain("Forget local credentials");
	});
	it("keeps configured fields empty and distinctly untested after reload", () => {
		const value = state("configured");
		const out = html({
			...value,
			connection: {
				...required(value.connection),
				fields: [{ ...field, configured: true }],
			},
		});
		expect(out).toContain("Credentials configured; not tested");
		expect(out).toContain('aria-label="X-Key"');
		expect(out).toContain('value=""');
		expect(out).toContain("Save credentials");
		expect(out).not.toContain(">Connected<");
	});
	it("never displays old Connected evidence while optional credentials are edited", () => {
		const value = state("connected");
		const optional = { ...field, required: false };
		const out = html(
			{
				...value,
				dirty: true,
				fields: [optional],
				values: { "header:X-Key": "replacement" },
				connection: {
					...required(value.connection),
					fields: [{ ...optional, configured: true }],
				},
			},
			{ tested: true },
		);
		expect(out).toContain(
			'class="mete-tool-status" role="status">Unsaved changes',
		);
		expect(out).not.toContain(">Connected<");
	});
	it.each([
		[{ kind: "saved_pending" }, "Saved; pending activation"],
		[{ kind: "testing" }, "Connecting..."],
		[{ kind: "failed", text: "safe detail" }, "Connection failed"],
	] as const)("retains a single semantic status for %s", (status, label) => {
		const out = html({ ...state("untested"), fields: [] }, { status });
		expect(out).toContain(`class="mete-tool-status" role="status">${label}`);
		expect(out.match(/class="mete-tool-status"/g)).toHaveLength(1);
	});
});

import { required } from "./required-fixture.js";
