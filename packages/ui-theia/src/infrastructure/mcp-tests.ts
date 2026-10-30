import type { Result } from "@mete/contracts";
import type { McpTestState } from "../application/mcp-test.js";
import { failureText } from "../application/status-text.js";
import type { DaemonFailure, McpTest } from "../domain/status-service.js";

// An MCP server's Test from the Settings card (ADR-164): `mete/mcp.test` on the click, connecting to
// the server as the daemon loaded it. The params are a plain id, so a refusal can only be the
// daemon's not_found (an unsaved or unapplied server) or not_supported (mcp-client is off).

/** What a Test needs from the widget, which knows the folder. */
export type McpTestDeps = {
	readonly test: (id: string) => Promise<Result<McpTest, DaemonFailure>>;
	readonly onChange: () => void;
};

const IDLE: McpTestState = { kind: "idle" };

const answered = (r: Result<McpTest, DaemonFailure>): McpTestState => {
	if (r.ok) return { kind: "done", answer: r.value };
	return r.error.code === "refused"
		? { kind: "not_loaded", detail: r.error.detail }
		: { kind: "failed", text: failureText(r.error) };
};

/** Each server's Test by id. */
export class McpTests {
	protected readonly states = new Map<string, McpTestState>();

	constructor(protected readonly deps: McpTestDeps) {}

	stateOf(id: string): McpTestState {
		return this.states.get(id) ?? IDLE;
	}

	/** Forgets every answer: a restarted daemon may have loaded other servers. */
	reset() {
		this.states.clear();
		this.deps.onChange();
	}

	async test(id: string) {
		if (!id || this.stateOf(id).kind === "testing") return;
		this.put(id, { kind: "testing" });
		this.put(id, answered(await this.deps.test(id)));
	}

	protected put(id: string, state: McpTestState) {
		this.states.set(id, state);
		this.deps.onChange();
	}
}
