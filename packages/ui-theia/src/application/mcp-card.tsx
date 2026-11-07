import { nls } from "@theia/core/lib/common/nls";
import { type ReactNode, useRef, useState } from "react";
import { ROW } from "./look.js";
import type { McpActions } from "./mcp-actions.js";

export type { McpActions, McpTextField } from "./mcp-actions.js";

import type { McpDraft, McpServerDraft } from "./mcp-draft.js";
import {
	McpConnectionStatus,
	McpTestPanel,
	type McpTestsView,
} from "./mcp-test.js";
import { Icon } from "./roster-look.js";
import { useRowKeys, withRowKeys } from "./row-keys.js";
import type { Target } from "./section-draft.js";
import { FormNote, type SaveNote } from "./settings-form.js";
import { ToolAdvanced } from "./tool-advanced.js";
import { ToolSetupView } from "./tool-setup-view.js";

// ADR-180: ordinary rows lead; technical fields remain behind Advanced.
// The parent owns saving, safe activation and catalog discovery.

/** The card's state, which the widget keeps. */
export type McpState = {
	readonly target: Target;
	/** The file the card edits now, or none when the global file is unknown. */
	readonly file?: string | undefined;
	readonly servers: McpDraft;
	readonly busy: boolean;
	readonly loading?: boolean | undefined;
	/** The target could not be read; retained drafts cannot be changed or saved yet. */
	readonly unread?: boolean;
	readonly dirty: boolean;
	readonly note?: SaveNote | undefined;
	/** Latest guided or catalog row accepted atomically, before saving or activation. */
	readonly prepared?: McpServerDraft | undefined;
};

/** Optional protocol33 management; ordinary guided setup keeps its existing ports. */
export type McpConnections = {
	readonly render: (server: McpServerDraft, index: number) => ReactNode;
	readonly blocked: (server: McpServerDraft) => boolean;
};

const ServerCard = ({
	index,
	server,
	actions,
	tests,
	dirty,
	busy,
	connection,
}: {
	readonly index: number;
	readonly server: McpServerDraft;
	readonly actions: McpActions;
	readonly tests?: McpTestsView | undefined;
	readonly dirty: boolean;
	readonly busy: boolean;
	readonly connection?: McpConnections | undefined;
}) => {
	const id = (field: string) => `mete-mcp-${index}-${field}`;
	const [expanded, setExpanded] = useState(!server.id);
	return (
		<div className="mete-tool-row">
			<div className="mete-tool-row-head">
				<strong id={id("name")}>
					{server.id || nls.localize("mete/tools/unnamed", "New server")}
				</strong>
				<span>{server.transport}</span>
				{connection ? null : (
					<McpConnectionStatus
						state={tests?.stateOf(server.id.trim()) ?? { kind: "idle" }}
						dirty={dirty}
					/>
				)}
			</div>
			<details
				className="mete-tool-advanced"
				open={expanded}
				onToggle={(event) => setExpanded(event.currentTarget.open)}
			>
				<summary>{nls.localize("mete/tools/advanced", "Advanced")}</summary>
				<fieldset disabled={busy} className="mete-tool-fields">
					<ToolAdvanced index={index} server={server} actions={actions} />
				</fieldset>
			</details>
			{connection?.render(server, index)}
			{tests ? (
				<McpTestPanel
					id={server.id.trim()}
					field={id}
					tests={tests}
					blocked={
						busy ||
						connection?.blocked(server) ||
						(dirty && !actions.onSaveConnect && !actions.onConnect)
					}
					dirty={dirty}
					onConnect={actions.onSaveConnect ?? actions.onConnect}
				/>
			) : null}
		</div>
	);
};

/** The mcp section's card: its servers, Add, where it saves, and what the last save said. */
export const McpCard = ({
	state,
	actions,
	tests,
	catalog,
	connection,
}: {
	readonly state: McpState;
	readonly actions: McpActions;
	readonly tests?: McpTestsView | undefined;
	/** Real catalog content is supplied by the parent; no discovery runs on mount. */
	readonly catalog?: ReactNode;
	readonly connection?: McpConnections | undefined;
}) => {
	const keyed = useRowKeys(state.servers.length);
	const acts = withRowKeys(actions, keyed);
	return (
		<div className="mete-tool-list" aria-busy={state.busy}>
			{state.busy ? (
				<span role="status">
					{state.loading
						? nls.localize("mete/tools/loading", "Loading tools...")
						: nls.localize("mete/tools/saving", "Saving tools...")}
				</span>
			) : null}
			{state.servers.map((server, i) => (
				<ServerCard
					key={keyed.keys[i]}
					index={i}
					server={server}
					actions={acts}
					tests={tests}
					dirty={state.dirty}
					busy={state.busy || state.unread === true}
					connection={connection}
				/>
			))}
			<AddControls
				busy={state.busy || state.unread === true}
				actions={actions}
			/>
			{catalog}
			<FormNote state={state} />
		</div>
	);
};

const AddControls = ({
	busy,
	actions,
}: {
	readonly busy: boolean;
	readonly actions: McpActions;
}) => {
	const [adding, setAdding] = useState(false);
	const addButton = useRef<HTMLButtonElement>(null);
	const close = () => {
		setAdding(false);
		addButton.current?.focus();
	};
	return (
		<>
			<div style={ROW}>
				<button
					type="button"
					className="mete-button quiet"
					ref={addButton}
					disabled={busy}
					aria-expanded={adding}
					onClick={() => (adding ? close() : setAdding(true))}
				>
					<Icon name="add" />
					{nls.localize("mete/settings/addServer", "Add server")}
				</button>
				{actions.onCatalog ? (
					<button
						type="button"
						className="mete-button quiet"
						disabled={busy}
						onClick={actions.onCatalog}
					>
						<Icon name="extensions" />
						{nls.localize("mete/tools/catalog", "Browse catalog")}
					</button>
				) : null}
			</div>
			{adding ? (
				<ToolSetupView
					onCancel={close}
					onAdvanced={() => {
						actions.onAdd();
						close();
					}}
					onAdd={(drafts) =>
						actions.onAddDraft?.(drafts) ?? {
							ok: false,
							error: nls.localize(
								"mete/tools/formUnavailable",
								"Wait for the tool list to finish loading.",
							),
						}
					}
				/>
			) : null}
		</>
	);
};
