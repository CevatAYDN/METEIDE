import { err, type McpSignInStarted, ok, type Result } from "@mete/contracts";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { McpCard } from "../src/application/mcp-card.js";
import type {
	McpConnectionSession,
	McpConnectionTarget,
} from "../src/application/mcp-connection-session.js";
import { serverDraftOf } from "../src/application/mcp-draft.js";
import { ToolCatalog } from "../src/application/tool-catalog.js";
import type { DaemonFailure } from "../src/domain/status-service.js";
import { McpSettings, probeMcp } from "../src/infrastructure/mcp-settings.js";
import { McpTests } from "../src/infrastructure/mcp-tests.js";

const field = {
	kind: "env" as const,
	name: "METE_TEST_KEY",
	required: true,
	secret: true,
};
const server = {
	id: "fixture",
	transport: "stdio" as const,
	runtime: "node" as const,
	command: "fixture",
	args: [],
	permissions: [],
	credentialFields: [field],
};
const setup = () => {
	const daemon = {
		mcpConnection: vi.fn(
			async (): Promise<Result<McpSignInStarted, DaemonFailure>> =>
				ok({
					state: {
						id: server.id,
						identity: "a".repeat(64),
						phase: "needs_credentials",
						fields: [],
					},
				}),
		),
		setMcpCredentials: vi.fn(async () => ok(null)),
		restartIdle: vi.fn(async () => ok(null)),
		mcpTest: vi.fn(async () =>
			ok({ id: server.id, ok: true as const, tools: [], ms: 1 }),
		),
	};
	const windows = { openNewWindow: vi.fn() };
	const settings = new McpSettings({ daemon, windows, changed: () => {} });
	const form = {
		state: {
			target: "workspace" as const,
			servers: [serverDraftOf(server)],
			dirty: false,
			busy: false,
		},
		actions: {
			onAdd: () => {},
			onField: vi.fn(),
			onPermission: vi.fn(),
			onRemove: vi.fn(),
			onSaveConnect: () => {},
		},
	};
	const tests = new McpTests({ test: daemon.mcpTest, onChange: () => {} });
	const view = () =>
		settings.view(form, tests, {
			busy: false,
			connect: () => {},
			catalog: undefined,
		});
	return { daemon, windows, settings, form, view };
};

describe("captured settings connection wiring", () => {
	it("does not fetch or connect during construction and gates missing required fields", async () => {
		const { settings, daemon, windows, form } = setup();
		await settings.workspace("/w");
		expect(settings.blocked(required(form.state.servers[0]))).toBe(true);
		await probeMcp({ dir: "/w", form, id: server.id, blocked: true, daemon });
		expect(daemon.mcpTest).not.toHaveBeenCalled();
		expect(daemon.mcpConnection).not.toHaveBeenCalled();
		expect(windows.openNewWindow).not.toHaveBeenCalled();
	});

	it("removes captured workspace targets immediately and leaves only a config-save note", async () => {
		const { settings, view } = setup();
		await settings.workspace("/w");
		await settings.workspace(undefined);
		const out = renderToStaticMarkup(createElement(McpCard, view()));
		expect(out).toContain("Save the server configuration");
		expect(out).not.toContain('type="password"');
	});

	it("retains narrow edit actions while invalidating captured sessions", () => {
		const { view, form } = setup();
		view().actions.onField(0, "command", "edited");
		expect(form.actions.onField).toHaveBeenCalledExactlyOnceWith(
			0,
			"command",
			"edited",
		);
		view().actions.onRemove(0);
		expect(form.actions.onRemove).toHaveBeenCalledExactlyOnceWith(0);
	});
	it.each([
		err({ code: "refused" as const, detail: "fixture not loaded; Apply now" }),
		ok({
			id: "fixture",
			ok: false as const,
			failed: {
				code: "io" as const,
				message: "fixture runtime missing; install runtime",
			},
		}),
	])("retains already sanitized probe repair diagnostics", async (result) => {
		const { settings, form } = setup();
		const tests = new McpTests({
			test: async () => result,
			onChange: () => {},
		});
		await tests.test("fixture");
		const view = settings.view(form, tests, {
			busy: false,
			connect: () => {},
			catalog: undefined,
		});
		expect(view.tests?.stateOf("fixture")).toEqual(tests.stateOf("fixture"));
		const out = renderToStaticMarkup(createElement(McpCard, view));
		expect(out).toContain(
			result.ok ? result.value.failed.message : result.error.detail,
		);
	});
	it("keeps an unsaved managed row's semantic status", () => {
		const { form, view } = setup();
		form.state.dirty = true;
		const out = renderToStaticMarkup(createElement(McpCard, view()));
		expect(out).toContain(
			'class="mete-tool-status" role="status">Unsaved changes',
		);
		expect(out.match(/class="mete-tool-status"/g)).toHaveLength(1);
	});
	it("blocks optional edits in the settings button and the direct probe port", async () => {
		const { settings, daemon, form, view } = setup();
		const optional = { ...field, required: false };
		const expected = { ...server, credentialFields: [optional] };
		form.state.servers = [serverDraftOf(expected)];
		daemon.mcpConnection.mockResolvedValue(
			ok({
				state: {
					id: server.id,
					identity: "a".repeat(64),
					phase: "connected",
					fields: [{ ...optional, configured: true }],
				},
			}),
		);
		await settings.workspace("/w");
		const row = view().connection?.render(required(form.state.servers[0]), 0);
		if (
			!isValidElement<{
				session: McpConnectionSession;
				target: McpConnectionTarget;
			}>(row)
		)
			throw new Error("Expected captured connection row");
		await row.props.session.show(row.props.target);
		expect(row.props.session.state.values).toEqual({});
		row.props.session.type("env:METE_TEST_KEY", "replacement");
		expect(view().connection?.blocked(required(form.state.servers[0]))).toBe(
			true,
		);
		await probeMcp({
			dir: "/w",
			form,
			id: server.id,
			blocked: false,
			connections: settings,
			daemon,
		});
		expect(daemon.mcpTest).not.toHaveBeenCalled();
		await settings.reset();
	});
	it("keeps catalog visibility explicit without fetching on toggle", () => {
		const { settings, form } = setup();
		const read = vi.fn(async () => ok({ entries: [] }));
		const catalog = new ToolCatalog({
			search: read,
			prepare: async () =>
				ok({
					server,
					fields: [field],
					source: "fixture",
					notes: [],
					blocked: false,
				}),
			add: () => true,
			onChange: () => {},
		});
		const tests = new McpTests({
			test: async () => ok({ id: server.id, ok: true, tools: [], ms: 1 }),
			onChange: () => {},
		});
		const view = () =>
			settings.view(form, tests, { busy: false, connect: () => {}, catalog });
		expect(view().catalog).toBeUndefined();
		view().actions.onCatalog?.();
		expect(view().catalog).toBeDefined();
		expect(read).not.toHaveBeenCalled();
	});
});

import { required } from "./required-fixture.js";
