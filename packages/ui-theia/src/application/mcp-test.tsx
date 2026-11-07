import { nls } from "@theia/core/lib/common/nls";
import type { McpTest } from "../domain/status-service.js";
import { Icon } from "./roster-look.js";

// An MCP server's Test on its card (ADR-164): one click connects to the server as METE loaded it and
// names its tools, or says why it failed; nothing is asked before the click.

/** One server's Test, from nothing asked yet to the daemon's answer. */
export type McpTestState =
	| { readonly kind: "idle" | "testing" | "saved_pending" }
	/** The daemon refused: it has not loaded the server, or mcp-client is off. */
	| { readonly kind: "not_loaded"; readonly detail: string }
	/** The request itself failed, already in words. */
	| { readonly kind: "failed"; readonly text: string }
	| { readonly kind: "done"; readonly answer: McpTest };

/** The Tests of the card's servers, and what they ask the widget for. */
export type McpTestsView = {
	readonly stateOf: (id: string) => McpTestState;
	readonly onTest: (id: string) => void;
};

/** A truthful row status; a previous successful probe never describes an edited draft. */
export const McpConnectionStatus = ({
	state,
	dirty = false,
}: {
	readonly state: McpTestState;
	readonly dirty?: boolean;
}) => (
	<span className="mete-tool-status" role="status">
		{connectionText(state, dirty)}
	</span>
);

const connectionText = (state: McpTestState, dirty: boolean) => {
	if (dirty) return nls.localize("mete/tools/unsaved", "Unsaved changes");
	if (state.kind === "saved_pending")
		return nls.localize("mete/tools/pending", "Saved; pending activation");
	if (state.kind === "testing")
		return nls.localize("mete/tools/connecting", "Connecting...");
	if (state.kind === "not_loaded")
		return nls.localize("mete/tools/notLoaded", "Not loaded");
	if (state.kind === "failed" || (state.kind === "done" && !state.answer.ok))
		return nls.localize("mete/tools/error", "Connection failed");
	if (state.kind === "done")
		return nls.localize("mete/tools/connected", "Connected");
	return nls.localize("mete/tools/notTested", "Not tested");
};

const toolsText = (tools: readonly string[]) =>
	tools.length === 0
		? nls.localize("mete/settings/mcpNoTools", "The server lists no tools.")
		: nls.localize(
				"mete/settings/mcpTools",
				"Tools ({0}): {1}",
				String(tools.length),
				tools.join(", "),
			);

const Answer = ({ answer }: { readonly answer: McpTest }) =>
	answer.ok ? (
		<>
			<span className="mete-endpoint-result">
				<Icon name="check" />
				{nls.localize("mete/settings/probeOk", "ok, {0} ms", String(answer.ms))}
			</span>
			<span>{toolsText(answer.tools)}</span>
		</>
	) : (
		<>
			<span className="mete-endpoint-result bad">
				<Icon name="close" />
				{answer.failed.code}
			</span>
			<span>{answer.failed.message}</span>
		</>
	);

const Line = ({
	id,
	state,
}: {
	readonly id: string;
	readonly state: McpTestState;
}) => {
	if (state.kind === "done") return <Answer answer={state.answer} />;
	if (state.kind === "failed") return <span>{state.text}</span>;
	if (state.kind !== "not_loaded") return null;
	return (
		<span>
			{nls.localize(
				"mete/settings/mcpNotLoaded",
				"METE has not loaded {0}: {1}.",
				id,
				state.detail,
			)}
		</span>
	);
};

/** The Test of one server; `field` names the card's elements, so the button is labelled by the
 * server's id as typed. */
export const McpTestPanel = ({
	id,
	field,
	tests,
	blocked = false,
	dirty = false,
	onConnect,
}: {
	readonly id: string;
	readonly field: (name: string) => string;
	readonly tests: McpTestsView;
	readonly blocked?: boolean | undefined;
	readonly dirty?: boolean;
	readonly onConnect?: ((id: string) => void) | undefined;
}) => {
	const state = tests.stateOf(id);
	const testing = state.kind === "testing";
	return (
		<div className="mete-mcp-test">
			<button
				type="button"
				id={field("test")}
				className="mete-button quiet"
				aria-labelledby={`${field("test")} ${field("id")}`}
				disabled={!id || testing || blocked}
				onClick={() => (onConnect ?? tests.onTest)(id)}
			>
				<Icon name={testing ? "loading" : "beaker"} spin={testing} />
				{testing
					? nls.localize("mete/settings/testing", "Testing…")
					: onConnect
						? actionText(state, dirty)
						: nls.localize("mete/settings/runTest", "Test")}
			</button>
			{/* One region that is always there, failures too: a screen reader reads each answer the
			    click asked for, and a region added with its text is not read everywhere. */}
			<div role="status" className="mete-mcp-answer">
				{blocked || dirty ? null : <Line id={id} state={state} />}
			</div>
		</div>
	);
};

const actionText = (state: McpTestState, dirty: boolean) => {
	if (dirty) return nls.localize("mete/tools/saveConnect", "Save and connect");
	if (state.kind === "failed" || (state.kind === "done" && !state.answer.ok))
		return nls.localize("mete/tools/retryConnect", "Retry connection");
	return nls.localize("mete/tools/connect", "Connect");
};
