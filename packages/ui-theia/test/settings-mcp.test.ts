import "reflect-metadata";
import {
	err,
	type McpConnectionRequest,
	type McpSignInStarted,
	ok,
	type Result,
} from "@mete/contracts";
import URI from "@theia/core/lib/common/uri";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { McpState } from "../src/application/mcp-card.js";
import type {
	McpConnectionSession,
	McpConnectionTarget,
} from "../src/application/mcp-connection-session.js";
import { EMPTY_MCP_SERVER } from "../src/application/mcp-draft.js";
import type { DaemonFailure } from "../src/domain/status-service.js";
import { McpSettings } from "../src/infrastructure/mcp-settings.js";
import { McpTests } from "../src/infrastructure/mcp-tests.js";
import { MeteSettingsWidget } from "../src/infrastructure/settings-widget.js";

vi.mock("../src/infrastructure/panel-widget.js", () => ({
	MetePanelWidget: class {
		update() {}
	},
}));
vi.mock("@theia/core", () => ({ CommandService: class {} }));
vi.mock("@theia/core/lib/browser/opener-service", () => ({
	OpenerService: class {},
	open: vi.fn(),
}));
vi.mock("@theia/core/lib/browser/theming", () => ({ ThemeService: class {} }));
vi.mock("@theia/core/lib/browser/widgets/widget", () => ({
	codicon: (name: string) => name,
}));
vi.mock("@theia/filesystem/lib/browser/file-service", () => ({
	FileService: class {},
}));
vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class {},
}));

class SettingsWidget extends MeteSettingsWidget {
	constructor(deps: object) {
		super();
		Object.assign(this, deps);
	}
	protected override async folderDir() {
		return "/w";
	}
	connect(id: string) {
		return this.connectTool(id);
	}
	save() {
		return this.saveAll();
	}
	applySettings() {
		return this.applyNow();
	}
}

const setup = async (active: boolean) => {
	let state: McpState = {
		target: "workspace",
		busy: false,
		dirty: true,
		servers: ["a", "b"].map((id) => ({ ...EMPTY_MCP_SERVER, id })),
	};
	const tests = new McpTests({
		test: async (id) => ok({ id, ok: true, tools: [], ms: 1 }),
		onChange: () => {},
	});
	await tests.test("b");
	const save = vi.fn(async () => {
		state = { ...state, dirty: false };
		return true;
	});
	const restartIdle = vi.fn();
	const widget = new SettingsWidget({
		mcp: { form: () => ({ state }), save },
		mcpTests: tests,
		daemon: { restartIdle },
		runStatus: async () => (active ? ok(1) : err("unknown status")),
	});
	return {
		widget,
		tests,
		save,
		restartIdle,
		unread: () => {
			state = { ...state, unread: true };
		},
	};
};

describe("MCP save activation in Settings", () => {
	it("explicit Apply reaches atomic idle admission without a ready model engine", async () => {
		const restartIdle = vi.fn(async () => ok(null));
		const refresh = vi.fn(async () => {});
		const widget = new SettingsWidget({
			workspace: {
				roots: Promise.resolve([{ resource: URI.fromFilePath("/w") }]),
			},
			daemon: {
				status: vi.fn(async () =>
					err({ code: "not_ready", detail: "no models" }),
				),
				restartIdle,
			},
			refresh,
		});
		await widget.applySettings();
		expect(restartIdle).toHaveBeenCalledExactlyOnceWith(
			URI.fromFilePath("/w").path.fsPath(),
		);
		expect(refresh).toHaveBeenCalledOnce();
	});
	it("does not refresh or interrupt work when the atomic gate refuses Apply", async () => {
		const restartIdle = vi.fn(async () =>
			err({ code: "refused", detail: "active work" }),
		);
		const refresh = vi.fn(async () => {});
		const widget = new SettingsWidget({
			workspace: {
				roots: Promise.resolve([{ resource: URI.fromFilePath("/w") }]),
			},
			daemon: {
				status: vi.fn(async () =>
					err({ code: "not_ready", detail: "no models" }),
				),
				restartIdle,
			},
			refresh,
		});
		await widget.applySettings();
		expect(restartIdle).toHaveBeenCalledOnce();
		expect(refresh).not.toHaveBeenCalled();
	});
	it("saves and activates a new OAuth row through the no-engine atomic gate", async () => {
		let state: McpState = {
			target: "workspace",
			busy: false,
			dirty: true,
			servers: [
				{
					...EMPTY_MCP_SERVER,
					id: "oauth",
					transport: "sse",
					auth: "oauth",
					url: "https://example.test/mcp",
				},
			],
		};
		const save = vi.fn(async () => {
			state = { ...state, dirty: false };
			return true;
		});
		const restartIdle = vi.fn(async () => ok(null));
		let loaded = false;
		const settings = vi.fn(async () => {
			loaded = true;
			return ok({ loadedAt: new Date().toISOString(), sections: [] });
		});
		const mcpConnection = vi.fn(
			async (
				_dir: string,
				input: McpConnectionRequest,
			): Promise<Result<McpSignInStarted, DaemonFailure>> => {
				if (!loaded)
					return err({ code: "refused", detail: "oauth not loaded" });
				const local = { id: "oauth", identity: "a".repeat(64), fields: [] };
				if (input.op !== "start")
					return ok({ state: { ...local, phase: "needs_sign_in" } });
				return ok({
					state: {
						...local,
						phase: "pending",
						attemptId: "11111111-1111-4111-8111-111111111111",
					},
					authorizationUrl: "https://login.example.test/authorize",
				});
			},
		);
		const daemon = {
			status: async () => err({ code: "not_ready", detail: "no models" }),
			restartIdle,
			settings,
			mcpConnection,
			setMcpCredentials: vi.fn(async () => ok(null)),
		};
		const windows = { openNewWindow: vi.fn() };
		const connections = new McpSettings({ daemon, windows, changed: () => {} });
		await connections.workspace("/w");
		const tests = new McpTests({
			test: async (id) => ok({ id, ok: true, tools: [], ms: 1 }),
			onChange: () => {},
		});
		const widget = new SettingsWidget({
			mcp: { form: () => ({ state }), save },
			mcpTests: tests,
			mcpConnections: connections,
			daemon,
		});
		await widget.connect("oauth");
		expect(save).toHaveBeenCalledOnce();
		expect(restartIdle).toHaveBeenCalledExactlyOnceWith("/w");
		expect(settings).toHaveBeenCalledOnce();
		expect(tests.stateOf("oauth")).toEqual({ kind: "idle" });
		const view = connections.view(
			{
				state,
				actions: {
					onAdd: () => {},
					onField: () => {},
					onPermission: () => {},
					onRemove: () => {},
				},
			},
			tests,
			{ busy: false, connect: () => {}, catalog: undefined },
		);
		const row = view.connection?.render(required(state.servers[0]), 0);
		if (
			!isValidElement<{
				session: McpConnectionSession;
				target: McpConnectionTarget;
			}>(row)
		)
			throw new Error("Expected captured connection row");
		await row.props.session.show(row.props.target);
		await row.props.session.run("start");
		expect(windows.openNewWindow).toHaveBeenCalledExactlyOnceWith(
			"https://login.example.test/authorize",
			{ external: true },
		);
		await connections.reset();
	});
	it("does not restart on passive Settings refresh without an engine", async () => {
		const restartIdle = vi.fn();
		const widget = new SettingsWidget({
			workspace: {
				roots: Promise.resolve([{ resource: URI.fromFilePath("/w") }]),
			},
			daemon: {
				status: async () => err({ code: "not_ready", detail: "no models" }),
				settings: async () =>
					ok({ loadedAt: new Date().toISOString(), sections: [] }),
				quota: async () => ok({ providers: [], units: [] }),
				restartIdle,
			},
		});
		await widget.refresh();
		expect(restartIdle).not.toHaveBeenCalled();
	});
	it.each([true, false])(
		"invalidates row B when A saves and activation cannot proceed (active=%s)",
		async (active) => {
			const { widget, tests, save, restartIdle } = await setup(active);
			await widget.connect("a");
			expect(save).toHaveBeenCalledOnce();
			expect(tests.stateOf("a")).toEqual({ kind: "saved_pending" });
			expect(tests.stateOf("b")).toEqual({ kind: "saved_pending" });
			expect(restartIdle).not.toHaveBeenCalled();
		},
	);

	it("uses the same invalidation for Save changes", async () => {
		const { widget, tests, save } = await setup(true);
		await widget.save();
		expect(save).toHaveBeenCalledOnce();
		expect(tests.stateOf("b")).toEqual({ kind: "saved_pending" });
	});

	it("never saves or connects an unread draft", async () => {
		const { widget, save, restartIdle, unread } = await setup(true);
		unread();
		await widget.connect("a");
		expect(save).not.toHaveBeenCalled();
		expect(restartIdle).not.toHaveBeenCalled();
	});
});

import { required } from "./required-fixture.js";
