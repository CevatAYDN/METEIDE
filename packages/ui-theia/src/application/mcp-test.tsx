import { nls } from "@theia/core/lib/common/nls";
import type { McpTest } from "../domain/status-service.js";
import { Icon } from "./roster-look.js";

// An MCP server's Test on its card (ADR-164): one click connects to the server as METE loaded it and
// names its tools, or says why it failed; nothing is asked before the click.

/** One server's Test, from nothing asked yet to the daemon's answer. */
export type McpTestState =
	| { readonly kind: "idle" | "testing" }
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
}: {
	readonly id: string;
	readonly field: (name: string) => string;
	readonly tests: McpTestsView;
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
				disabled={!id || testing}
				onClick={() => tests.onTest(id)}
			>
				<Icon name={testing ? "loading" : "beaker"} spin={testing} />
				{testing
					? nls.localize("mete/settings/testing", "Testing…")
					: nls.localize("mete/settings/runTest", "Test")}
			</button>
			{/* One region that is always there, failures too: a screen reader reads each answer the
			    click asked for, and a region added with its text is not read everywhere. */}
			<div role="status" className="mete-mcp-answer">
				<Line id={id} state={state} />
			</div>
		</div>
	);
};
