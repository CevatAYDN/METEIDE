import type { McpConnectionState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { McpConnectionViewState } from "./mcp-connection-session.js";
import { McpConnectionStatus, type McpTestState } from "./mcp-test.js";

const phases = (): Record<McpConnectionState["phase"], string> => ({
	needs_sign_in: nls.localize("mete/tools/signInRequired", "Sign-in required"),
	needs_credentials: nls.localize(
		"mete/tools/credentialsRequired",
		"Credentials required",
	),
	untested: nls.localize("mete/tools/notTested", "Not tested"),
	configured: nls.localize(
		"mete/tools/credentialsConfigured",
		"Credentials configured; not tested",
	),
	pending: nls.localize("mete/tools/signInPending", "Waiting for sign-in"),
	connected: nls.localize("mete/tools/connected", "Connected"),
	cancelled: nls.localize("mete/tools/signInCancelled", "Sign-in cancelled"),
	expired: nls.localize("mete/tools/signInExpired", "Sign-in expired"),
	failed: nls.localize("mete/tools/error", "Connection failed"),
});

const connectionLabel = (state: McpConnectionViewState, tested?: boolean) => {
	const pending = state.connection?.phase === "pending";
	const missing = state.fields.some(
		(f) =>
			f.required &&
			!state.connection?.fields.some(
				(saved) =>
					saved.kind === f.kind && saved.name === f.name && saved.configured,
			),
	);
	if (missing && !pending) return phases().needs_credentials;
	if (tested && !pending && !state.busy && !state.error)
		return phases().connected;
	const phase = state.connection?.phase ?? "untested";
	return phases()[
		phase === "connected" && (state.busy || state.error) ? "untested" : phase
	];
};

/** One semantic status combines configuration, probe and write-only credential evidence. */
export const McpManagedStatus = (props: {
	readonly state: McpConnectionViewState;
	readonly status?: McpTestState | undefined;
	readonly tested?: boolean | undefined;
}) => {
	const { state, status, tested } = props;
	if (state.dirty)
		return <McpConnectionStatus state={{ kind: "idle" }} dirty />;
	if (
		state.connection?.phase !== "pending" &&
		status &&
		status.kind !== "idle" &&
		!(status.kind === "done" && status.answer.ok)
	)
		return <McpConnectionStatus state={status} />;
	return (
		<span className="mete-tool-status" role="status">
			{connectionLabel(state, tested)}
		</span>
	);
};
