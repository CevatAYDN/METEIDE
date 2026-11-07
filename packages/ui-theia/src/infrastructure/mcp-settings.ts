import { err, ok, type Result } from "@mete/contracts";
import type { WindowService } from "@theia/core/lib/browser/window/window-service";
import { nls } from "@theia/core/lib/common/nls";
import { createElement } from "react";
import { McpConnectionSession } from "../application/mcp-connection-session.js";
import { McpConnectionRow } from "../application/mcp-connection-view.js";
import type { McpServerDraft } from "../application/mcp-draft.js";
import type { Mcp } from "../application/settings-section.js";
import type { ApplyState } from "../application/settings-view.js";
import { failureText } from "../application/status-text.js";
import { activateTools } from "../application/tool-activation.js";
import { ToolCatalog } from "../application/tool-catalog.js";
import { ToolCatalogView } from "../application/tool-catalog-view.js";
import { expectedTool } from "../application/tool-expected.js";
import { MCP_CONNECTION_POLL_MS } from "../defaults.js";
import type { MeteDaemonService } from "../domain/status-service.js";
import type { McpForm } from "./mcp-form.js";
import { McpTests } from "./mcp-tests.js";

type Form = NonNullable<ReturnType<McpForm["form"]>>;
type ConnectionDaemon = Pick<
	MeteDaemonService,
	"mcpConnection" | "setMcpCredentials" | "restartIdle"
>;

/** Construct management without fetching, signing in, connecting or writing on startup. */
export const createMcpSettings = (deps: {
	readonly daemon: ConnectionDaemon &
		Pick<MeteDaemonService, "registrySearch" | "registrySetup">;
	readonly windows: Pick<WindowService, "openNewWindow">;
	readonly dir: () => Promise<string>;
	readonly form: () => McpForm | undefined;
	readonly test: (id: string) => ReturnType<MeteDaemonService["mcpTest"]>;
	readonly changed: () => void;
}) => {
	const connections = new McpSettings(deps);
	return {
		connections,
		dispose: () => void connections.reset(),
		tests: new McpTests({ test: deps.test, onChange: deps.changed }),
		catalog: new ToolCatalog({
			search: async (query) =>
				deps.daemon.registrySearch(await deps.dir(), query),
			prepare: async (name) =>
				deps.daemon.registrySetup(await deps.dir(), name),
			add: (server) => deps.form()?.addDraft(server) ?? false,
			onChange: deps.changed,
		}),
	};
};

/** Settings-only wiring keeps every row's workspace and ephemeral credentials captured. */
export class McpSettings {
	private readonly sessions = new Map<string, McpConnectionSession>();
	private retiring: Promise<void> = Promise.resolve();
	private tests: McpTests | undefined;
	private showCatalog = false;
	dir: string | undefined;
	constructor(
		private readonly deps: {
			readonly daemon: ConnectionDaemon;
			readonly windows: Pick<WindowService, "openNewWindow">;
			readonly changed: () => void;
		},
	) {}
	workspace(dir: string | undefined) {
		if (this.dir === dir) return this.retiring;
		this.dir = dir;
		return this.reset();
	}
	async reset() {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		this.retiring = Promise.all([
			this.retiring,
			...sessions.map((session) => session.clear()),
		]).then(() => {});
		await this.retiring;
	}
	blocked(draft: McpServerDraft, activation = false) {
		const expected = expectedTool(draft),
			session = this.sessions.get(draft.id.trim());
		if (!expected) return true;
		const required =
			expected.credentialFields?.some((field) => field.required) ||
			(expected.transport !== "stdio" && expected.auth === "oauth");
		// An unloaded row can only request atomic activation, never a credential-less probe.
		const unloaded = activation && !session?.state.connection;
		return (
			!!session?.state.busy ||
			!!session?.state.dirty ||
			(!unloaded && !!session?.state.error) ||
			session?.state.connection?.phase === "pending" ||
			(!unloaded && !!required && !session?.canConnect)
		);
	}
	private session(id: string) {
		let session = this.sessions.get(id);
		if (session) return session;
		session = new McpConnectionSession({
			connection: (dir, input) => this.deps.daemon.mcpConnection(dir, input),
			credentials: async (dir, input) => {
				const result = await this.deps.daemon.setMcpCredentials(dir, input);
				if (result.ok && this.dir === dir) this.tests?.reset();
				return result;
			},
			restart: async (dir) => {
				const result = await this.deps.daemon.restartIdle(dir);
				if (result.ok && this.dir === dir) this.tests?.reset();
				return result;
			},
			open: (url) => this.deps.windows.openNewWindow(url, { external: true }),
			changed: this.deps.changed,
			schedule: (callback) => {
				const timer = setTimeout(callback, MCP_CONNECTION_POLL_MS);
				return () => clearTimeout(timer);
			},
		});
		this.sessions.set(id, session);
		return session;
	}
	view(
		form: Form,
		tests: McpTests,
		options: {
			readonly busy: boolean;
			readonly connect: (id: string) => void;
			readonly catalog: ToolCatalog | undefined;
		},
	): Mcp {
		this.tests = tests;
		return {
			...form,
			state: { ...form.state, busy: form.state.busy || options.busy },
			actions: this.actions(form, options),
			catalog:
				this.showCatalog && options.catalog
					? createElement(ToolCatalogView, { catalog: options.catalog })
					: undefined,
			tests: {
				stateOf: (id) => tests.stateOf(id),
				onTest: options.connect,
			},
			connection: {
				blocked: (draft) => this.blocked(draft, true),
				render: (draft) => this.row(form, draft, tests, options.busy),
			},
		};
	}
	private actions(form: Form, options: { connect: (id: string) => void }) {
		const reset = () => {
			void this.reset();
		};
		return {
			...form.actions,
			onSaveConnect: options.connect,
			onCatalog: () => {
				this.showCatalog = !this.showCatalog;
				this.deps.changed();
			},
			onField: (...args: Parameters<typeof form.actions.onField>) => {
				reset();
				form.actions.onField(...args);
			},
			onPermission: (...args: Parameters<typeof form.actions.onPermission>) => {
				reset();
				form.actions.onPermission(...args);
			},
			onRemove: (index: number) => {
				reset();
				form.actions.onRemove(index);
			},
		};
	}
	private row(
		form: Form,
		draft: McpServerDraft,
		tests: McpTests,
		busy: boolean,
	) {
		const expected = expectedTool(draft),
			dir = this.dir;
		const target =
			dir && expected && !form.state.dirty && !form.state.unread
				? { dir, scope: form.state.target, expected }
				: undefined;
		return createElement(McpConnectionRow, {
			session: this.session(draft.id.trim()),
			target,
			disabled: busy || form.state.busy,
			status: tests.stateOf(draft.id.trim()),
			dirty: form.state.dirty,
		});
	}
}

type ConnectDeps = {
	readonly id: string;
	readonly dir: () => Promise<string>;
	readonly form: McpForm | undefined;
	readonly tests: McpTests | undefined;
	readonly connections: McpSettings | undefined;
	readonly busy: boolean;
	readonly current: () => boolean;
	readonly status: (dir: string) => Promise<Result<number | undefined, string>>;
	readonly daemon: Pick<MeteDaemonService, "restartIdle">;
	readonly loaded: (dir: string) => Promise<boolean>;
	readonly changed: (state: ApplyState) => void;
};
const connectTarget = async (deps: ConnectDeps) => {
	const dir = await deps.dir(),
		form = deps.form?.form(),
		tests = deps.tests;
	const draft = form?.state.servers.find(
		(server) => server.id.trim() === deps.id,
	);
	if (
		!deps.current() ||
		!form ||
		!tests ||
		!draft ||
		!dir ||
		form.state.unread ||
		form.state.busy ||
		deps.busy ||
		(deps.connections &&
			(deps.connections.dir !== dir || deps.connections.blocked(draft, true)))
	)
		return undefined;
	return { dir, form, tests };
};

/** Existing save/idle/probe sequence, now also gated by required credentials. */
export const connectMcp = async (deps: ConnectDeps): Promise<void> => {
	const target = await connectTarget(deps);
	if (!target) return;
	const { dir, form, tests } = target;
	deps.changed({ busy: true, activeRuns: 0 });
	const result = await activateTools({
		probe: form.state.dirty ? undefined : () => tests.testCurrent(deps.id),
		save: async () => !form.state.dirty || ((await deps.form?.save()) ?? false),
		status: () => deps.status(dir),
		restart: async () => {
			const result = await deps.daemon.restartIdle(dir);
			return result.ok ? ok(null) : err(failureText(result.error));
		},
		loaded: async () => {
			if (!(await deps.loaded(dir))) return false;
			await deps.connections?.reset();
			return true;
		},
		test: async () => {
			const draft = deps.form
				?.form()
				?.state.servers.find((row) => row.id.trim() === deps.id);
			if (draft && !deps.connections?.blocked(draft)) await tests.test(deps.id);
		},
		pending: () => tests.saved(form.state.servers),
	});
	deps.changed({
		busy: false,
		activeRuns: result.kind === "pending" ? result.activeRuns : 0,
		error: result.kind === "failed" ? result.error : undefined,
	});
};

const probeRefusal = (form: Form | undefined) =>
	form?.state.dirty
		? nls.localize(
				"mete/tools/saveFirst",
				"Save this server before connecting.",
			)
		: nls.localize("mete/tools/credentialsRequired", "Credentials required");

/** Exact draft comparison remains a backend decision; UI never probes missing requirements. */
export const probeMcp = async (deps: {
	readonly dir: string;
	readonly form: Form | undefined;
	readonly id: string;
	readonly blocked: boolean;
	readonly connections?: McpSettings | undefined;
	readonly daemon: Pick<MeteDaemonService, "mcpTest">;
}) => {
	const draft = deps.form?.state.servers.find(
		(entry) => entry.id.trim() === deps.id,
	);
	const expected = expectedTool(draft);
	if (
		!expected ||
		deps.form?.state.dirty ||
		deps.form?.state.unread ||
		deps.blocked ||
		(deps.connections &&
			(deps.connections.dir !== deps.dir ||
				!draft ||
				deps.connections.blocked(draft)))
	)
		return err({
			code: "refused" as const,
			detail: probeRefusal(deps.form),
		});
	const result = await deps.daemon.mcpTest(deps.dir, deps.id, expected);
	return result.ok ? ok(result.value) : result;
};
