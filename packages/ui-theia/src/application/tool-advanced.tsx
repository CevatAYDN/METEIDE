import { nls } from "@theia/core/lib/common/nls";
import type { McpActions, McpTextField } from "./mcp-actions.js";
import {
	AUTHS,
	type McpServerDraft,
	PERMISSIONS,
	RUNTIMES,
	TRANSPORTS,
} from "./mcp-draft.js";
import { Icon } from "./roster-look.js";
import { Select, TextArea, TextField } from "./text-field.js";

type Fields = {
	readonly id: (field: string) => string;
	readonly server: McpServerDraft;
	readonly edit: (field: McpTextField) => (value: string) => void;
};

const Permissions = ({
	index,
	server,
	actions,
}: {
	readonly index: number;
	readonly server: McpServerDraft;
	readonly actions: McpActions;
}) => (
	<fieldset className="mete-tool-permissions">
		<legend>{nls.localize("mete/settings/permissions", "Permissions")}</legend>
		<div className="mete-tool-actions">
			{PERMISSIONS.map((permission) => (
				<label key={permission}>
					<input
						id={`mete-mcp-${index}-permissions-${permission}`}
						type="checkbox"
						checked={server.permissions.includes(permission)}
						onChange={(e) =>
							actions.onPermission(index, permission, e.target.checked)
						}
					/>
					{permission}
				</label>
			))}
		</div>
	</fieldset>
);

const DownloadFields = ({ id, server, edit }: Fields) => (
	<div className="mete-tool-pair">
		<TextField
			id={id("url")}
			label={nls.localize("mete/settings/serverUrl", "URL")}
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

const StdioFields = ({ id, server, edit }: Fields) => (
	<>
		<div className="mete-tool-pair">
			<Select
				id={id("runtime")}
				label={nls.localize("mete/settings/runtime", "Runtime")}
				value={server.runtime}
				options={RUNTIMES}
				onChange={edit("runtime")}
			/>
			<TextField
				id={id("command")}
				label={nls.localize("mete/settings/command", "Command")}
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

const RemoteFields = ({ id, server, edit }: Fields) => (
	<div className="mete-tool-pair">
		<TextField
			id={id("url")}
			label={nls.localize("mete/settings/serverUrl", "URL")}
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

/** Existing advanced fields retain every transport, binary download, env and permission option. */
export const ToolAdvanced = ({
	index,
	server,
	actions,
}: {
	readonly index: number;
	readonly server: McpServerDraft;
	readonly actions: McpActions;
}) => {
	const id = (field: string) => `mete-mcp-${index}-${field}`;
	const edit = (field: McpTextField) => (value: string) =>
		actions.onField(index, field, value);
	return (
		<>
			<div className="mete-tool-pair">
				<TextField
					id={id("id")}
					label={nls.localize("mete/settings/serverId", "Server id")}
					value={server.id}
					onChange={edit("id")}
				/>
				<Select
					id={id("transport")}
					label={nls.localize("mete/settings/transport", "Transport")}
					value={server.transport}
					options={TRANSPORTS}
					onChange={edit("transport")}
				/>
			</div>
			{server.transport === "stdio" ? (
				<StdioFields id={id} server={server} edit={edit} />
			) : null}
			{server.transport === "streamable-http" || server.transport === "sse" ? (
				<RemoteFields id={id} server={server} edit={edit} />
			) : null}
			<Permissions index={index} server={server} actions={actions} />
			<button
				type="button"
				className="mete-button quiet"
				onClick={() => actions.onRemove(index)}
			>
				<Icon name="trash" />
				{nls.localize("mete/settings/remove", "Remove")}
			</button>
		</>
	);
};
