import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { MUTED, ROW } from "./look.js";
import {
	AUTHS,
	type McpDraft,
	type McpServerDraft,
	PERMISSIONS,
	RUNTIMES,
	TRANSPORTS,
} from "./mcp-draft.js";
import { McpTestPanel, type McpTestsView } from "./mcp-test.js";
import type { Target } from "./section-draft.js";
import { FormNote, type SaveNote } from "./settings-form.js";
import { Select, TextArea, TextField } from "./text-field.js";

// The MCP servers card of the tools group (ADR-097): one card per server, with the fields of the
// shape its transport names. The scope switch and the save bar move and save it with the forms, so
// the card has no target choice and no Save of its own.

/** The card's state, which the widget keeps. */
export type McpState = {
	readonly target: Target;
	/** The file the card edits now, or none when the global file is unknown. */
	readonly file?: string | undefined;
	readonly servers: McpDraft;
	readonly busy: boolean;
	readonly dirty: boolean;
	readonly note?: SaveNote | undefined;
};

/** The fields the card types into; a permission has its own action. */
export type McpTextField = Exclude<keyof McpServerDraft, "permissions">;

/** What the card asks the widget for. */
export type McpActions = {
	readonly onField: (index: number, key: McpTextField, value: string) => void;
	readonly onPermission: (
		index: number,
		permission: string,
		on: boolean,
	) => void;
	readonly onAdd: () => void;
	readonly onRemove: (index: number) => void;
};

const COLUMN = {
	display: "flex",
	flexDirection: "column",
	gap: "4px",
} as const;

// Two fields side by side, such as an id and its transport.
const PAIR: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
	gap: "8px",
};

const idWord = () => nls.localize("mete/settings/serverId", "Server id");
const transportWord = () =>
	nls.localize("mete/settings/transport", "Transport");
const runtimeWord = () => nls.localize("mete/settings/runtime", "Runtime");
const commandWord = () => nls.localize("mete/settings/command", "Command");
const urlWord = () => nls.localize("mete/settings/serverUrl", "URL");

// The permissions of a server, from the contract's list, as boxes rather than typed ids.
const Permissions = ({
	id,
	picked,
	onToggle,
}: {
	readonly id: string;
	readonly picked: readonly string[];
	readonly onToggle: (permission: string, on: boolean) => void;
}) => (
	<fieldset style={{ ...COLUMN, border: 0, padding: 0, margin: 0 }}>
		<legend style={{ padding: 0 }}>
			{nls.localize("mete/settings/permissions", "Permissions")}
		</legend>
		<div style={ROW}>
			{PERMISSIONS.map((permission) => (
				<label key={permission} style={ROW}>
					<input
						id={`${id}-${permission}`}
						type="checkbox"
						checked={picked.includes(permission)}
						onChange={(e) => onToggle(permission, e.target.checked)}
					/>
					{permission}
				</label>
			))}
		</div>
	</fieldset>
);

// A binary server's download: where it comes from, and the SHA-256 it must have.
const DownloadFields = ({
	id,
	server,
	edit,
}: {
	readonly id: (field: string) => string;
	readonly server: McpServerDraft;
	readonly edit: (field: McpTextField) => (value: string) => void;
}) => (
	<div style={PAIR}>
		<TextField
			id={id("url")}
			label={urlWord()}
			value={server.url}
			placeholder="https://"
			onChange={edit("url")}
		/>
		<TextField
			id={id("sha256")}
			label={nls.localize("mete/settings/sha256", "SHA-256 of the download")}
			value={server.sha256}
			onChange={edit("sha256")}
		/>
	</div>
);

// The fields a local server runs with; a binary one adds its download.
const StdioFields = ({
	id,
	server,
	edit,
}: {
	readonly id: (field: string) => string;
	readonly server: McpServerDraft;
	readonly edit: (field: McpTextField) => (value: string) => void;
}) => (
	<>
		<div style={PAIR}>
			<Select
				id={id("runtime")}
				label={runtimeWord()}
				value={server.runtime}
				options={RUNTIMES}
				onChange={edit("runtime")}
			/>
			<TextField
				id={id("command")}
				label={commandWord()}
				value={server.command}
				placeholder="uvx"
				onChange={edit("command")}
			/>
		</div>
		<TextArea
			id={id("args")}
			label={nls.localize("mete/settings/args", "Arguments, one per line")}
			value={server.args}
			onChange={edit("args")}
		/>
		<TextArea
			id={id("env")}
			label={nls.localize(
				"mete/settings/env",
				"Environment, one Name=value per line",
			)}
			value={server.env}
			onChange={edit("env")}
		/>
		{server.runtime === "binary" ? (
			<DownloadFields id={id} server={server} edit={edit} />
		) : null}
	</>
);

// The fields a remote server answers with.
const RemoteFields = ({
	id,
	server,
	edit,
}: {
	readonly id: (field: string) => string;
	readonly server: McpServerDraft;
	readonly edit: (field: McpTextField) => (value: string) => void;
}) => (
	<div style={PAIR}>
		<TextField
			id={id("url")}
			label={urlWord()}
			value={server.url}
			placeholder="https://"
			onChange={edit("url")}
		/>
		<Select
			id={id("auth")}
			label={nls.localize("mete/settings/auth", "Sign-in")}
			value={server.auth === "" ? "none" : server.auth}
			options={AUTHS}
			blank={false}
			onChange={edit("auth")}
		/>
	</div>
);

const ServerCard = ({
	index,
	server,
	actions,
	tests,
}: {
	readonly index: number;
	readonly server: McpServerDraft;
	readonly actions: McpActions;
	readonly tests?: McpTestsView | undefined;
}) => {
	const id = (field: string) => `mete-mcp-${index}-${field}`;
	const edit = (field: McpTextField) => (value: string) =>
		actions.onField(index, field, value);
	const stdio = server.transport === "stdio";
	const remote =
		server.transport === "streamable-http" || server.transport === "sse";
	return (
		<fieldset className="mete-card" style={{ ...COLUMN, gap: "8px" }}>
			<div style={PAIR}>
				<TextField
					id={id("id")}
					label={idWord()}
					value={server.id}
					placeholder="blender"
					onChange={edit("id")}
				/>
				<Select
					id={id("transport")}
					label={transportWord()}
					value={server.transport}
					options={TRANSPORTS}
					onChange={edit("transport")}
				/>
			</div>
			{stdio ? <StdioFields id={id} server={server} edit={edit} /> : null}
			{remote ? <RemoteFields id={id} server={server} edit={edit} /> : null}
			<Permissions
				id={id("permissions")}
				picked={server.permissions}
				onToggle={(permission, on) =>
					actions.onPermission(index, permission, on)
				}
			/>
			{tests ? (
				<McpTestPanel id={server.id.trim()} field={id} tests={tests} />
			) : null}
			<div style={ROW}>
				<button
					type="button"
					className="mete-button quiet"
					onClick={() => actions.onRemove(index)}
				>
					{nls.localize("mete/settings/remove", "Remove")}
				</button>
			</div>
		</fieldset>
	);
};

/** The mcp section's card: its servers, Add, where it saves, and what the last save said. */
export const McpCard = ({
	state,
	actions,
	tests,
}: {
	readonly state: McpState;
	readonly actions: McpActions;
	readonly tests?: McpTestsView | undefined;
}) => (
	<div style={{ ...COLUMN, gap: "8px" }}>
		<span style={MUTED}>
			{nls.localize(
				"mete/settings/mcpHint",
				"One card per server: a local one runs a command, a remote one answers at a URL. The built-in Exa server is not a card until a file names it.",
			)}
		</span>
		{tests ? (
			<span style={MUTED}>
				{nls.localize(
					"mete/settings/mcpTestHint",
					"Test connects to a server as METE loaded it: after an edit, save and press Apply now first.",
				)}
			</span>
		) : null}
		{state.servers.map((server, i) => (
			<ServerCard
				// biome-ignore lint/suspicious/noArrayIndexKey: a server has no stable id while its id is typed
				key={i}
				index={i}
				server={server}
				actions={actions}
				tests={tests}
			/>
		))}
		<div style={ROW}>
			<button
				type="button"
				className="mete-button quiet"
				onClick={actions.onAdd}
			>
				{nls.localize("mete/settings/addServer", "Add server")}
			</button>
		</div>
		<FormNote state={state} />
	</div>
);
