import {
	type McpCredentialField,
	McpCredentialWriteSchema,
} from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { useEffect, useRef, useState } from "react";
import type {
	McpConnectionSession,
	McpConnectionTarget,
	McpConnectionViewState,
} from "./mcp-connection-session.js";
import { McpManagedStatus } from "./mcp-connection-status.js";
import { McpConnectionStatus, type McpTestState } from "./mcp-test.js";
import { Icon } from "./roster-look.js";

type Operation = "status" | "start" | "forget" | "cancel";
type Props = {
	readonly id: string;
	readonly state: McpConnectionViewState;
	readonly oauth: boolean;
	readonly disabled: boolean;
	readonly tested?: boolean;
	readonly status?: McpTestState | undefined;
	readonly onType: (key: string, value: string) => void;
	readonly onRun: (op: Operation) => void;
	readonly onSave: () => void;
	readonly onAdd: (name: string, secret: boolean) => void;
};
const errors = () => ({
	required: nls.localize(
		"mete/tools/credentialValuesRequired",
		"Enter every required value before saving credentials.",
	),
	invalid: nls.localize(
		"mete/tools/credentialInvalid",
		"Check field names and values; unsupported or reserved fields cannot be saved.",
	),
	unavailable: nls.localize(
		"mete/tools/connectionUnavailable",
		"Could not update this connection. Retry local status or sign in again.",
	),
	restart: nls.localize(
		"mete/tools/connectionRestartFailed",
		"Credentials may have changed, but METE could not reopen idle work. Retry before connecting.",
	),
});
const Action = (props: {
	readonly name: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly onClick: () => void;
}) => (
	<button
		type="button"
		className="mete-button quiet"
		disabled={props.disabled}
		title={props.label}
		onClick={props.onClick}
	>
		<Icon name={props.name} />
		{props.label}
	</button>
);

/** Compact write-only fields and explicit local connection actions, using the active theme. */
export const McpConnectionView = (props: Props) => {
	const { id, state, disabled, tested } = props;
	const off = disabled || state.busy;
	const pending = state.connection?.phase === "pending";
	return (
		<div className="mete-mcp-connection" aria-busy={state.busy}>
			<McpManagedStatus state={state} tested={tested} status={props.status} />
			<ConnectionActions {...props} disabled={off} />
			{props.oauth ? (
				<p className="mete-tools-note">
					{nls.localize(
						"mete/tools/forgetLocalOnly",
						"Local cleanup does not revoke access at the remote account.",
					)}
				</p>
			) : null}
			<CredentialForm {...props} disabled={off || pending} />
			<ManualField id={id} disabled={off || pending} onAdd={props.onAdd} />
			<div
				id={`${id}-credentials-error`}
				role="alert"
				className="mete-tools-error"
			>
				{state.error ? errors()[state.error] : null}
			</div>
		</div>
	);
};

const commandLabels = () => ({
	start: nls.localize("mete/tools/signIn", "Sign in"),
	cancel: nls.localize("mete/tools/cancelSignIn", "Cancel sign-in"),
	status: nls.localize("mete/tools/retryLocalStatus", "Retry local status"),
	forget: nls.localize(
		"mete/tools/forgetLocalCredentials",
		"Forget local credentials",
	),
});
const commandIcons = {
	start: "link-external",
	cancel: "close",
	status: "refresh",
	forget: "trash",
};
const ConnectionActions = ({ state, oauth, disabled, onRun }: Props) => {
	const pending = state.connection?.phase === "pending";
	const ops: Operation[] = pending ? ["cancel"] : oauth ? ["start"] : [];
	ops.push("status", "forget");
	return (
		<div className="mete-tool-actions">
			{ops.map((op) => (
				<Action
					key={op}
					name={commandIcons[op]}
					label={commandLabels()[op]}
					disabled={disabled || (op === "forget" && pending)}
					onClick={() => onRun(op)}
				/>
			))}
		</div>
	);
};

const CredentialForm = ({ id, state, disabled, onType, onSave }: Props) => {
	if (!state.fields.length) return null;
	const ready =
		state.fields.every(
			(f) => !f.required || !!state.values[`${f.kind}:${f.name}`],
		) && McpCredentialWriteSchema.shape.values.safeParse(state.values).success;
	return (
		<form
			className="mete-tool-fields"
			onSubmit={(event) => {
				event.preventDefault();
				if (ready && !disabled) onSave();
			}}
		>
			<fieldset disabled={disabled} className="mete-tool-fields">
				{state.fields.map((field, index) => (
					<CredentialInput
						key={`${field.kind}:${field.name}`}
						id={id}
						index={index}
						field={field}
						state={state}
						onType={onType}
					/>
				))}
			</fieldset>
			<button
				type="submit"
				className="mete-button quiet"
				disabled={
					disabled || !ready || !Object.values(state.values).some(Boolean)
				}
			>
				<Icon name="key" />
				{nls.localize("mete/tools/saveCredentials", "Save credentials")}
			</button>
		</form>
	);
};

const CredentialInput = (
	props: Pick<Props, "id" | "state" | "onType"> & {
		readonly index: number;
		readonly field: McpCredentialField;
	},
) => {
	const { id, index, field, state, onType } = props;
	const key = `${field.kind}:${field.name}`;
	const configured = state.connection?.fields.some(
		(f) => f.kind === field.kind && f.name === field.name && f.configured,
	);
	return (
		<label className="mete-tool-field" htmlFor={`${id}-credential-${index}`}>
			<span>
				{field.name}{" "}
				{configured
					? nls.localize("mete/tools/valueConfigured", "(saved)")
					: null}
			</span>
			{field.description ? (
				<span className="mete-tools-note">{field.description}</span>
			) : null}
			<input
				id={`${id}-credential-${index}`}
				className="mete-field"
				type={field.secret ? "password" : "text"}
				autoComplete="off"
				spellCheck={false}
				required={field.required}
				value={state.values[key] ?? ""}
				aria-label={field.name}
				aria-invalid={!!state.error}
				aria-describedby={`${id}-credentials-error`}
				onChange={(event) => onType(key, event.currentTarget.value)}
			/>
		</label>
	);
};

const ManualField = ({
	id,
	disabled,
	onAdd,
}: Pick<Props, "id" | "disabled" | "onAdd">) => {
	const [name, setName] = useState("");
	const [secret, setSecret] = useState(true);
	return (
		<details className="mete-tool-advanced">
			<summary>
				{nls.localize("mete/tools/addCredentialField", "Add credential field")}
			</summary>
			<form
				className="mete-tool-fields"
				onSubmit={(event) => {
					event.preventDefault();
					if (!disabled && name.trim()) {
						onAdd(name, secret);
						setName("");
					}
				}}
			>
				<ManualInputs
					id={id}
					name={name}
					secret={secret}
					disabled={disabled}
					onName={setName}
					onSecret={setSecret}
				/>
				<AddFieldButton disabled={disabled || !name.trim()} />
			</form>
		</details>
	);
};

const AddFieldButton = ({ disabled }: { readonly disabled: boolean }) => {
	const label = nls.localize(
		"mete/tools/addCredentialField",
		"Add credential field",
	);
	return (
		<button
			type="submit"
			className="mete-button quiet icon"
			disabled={disabled}
			title={label}
			aria-label={label}
		>
			<Icon name="add" />
		</button>
	);
};

const ManualInputs = ({
	id,
	name,
	secret,
	disabled,
	onName,
	onSecret,
}: {
	readonly id: string;
	readonly name: string;
	readonly secret: boolean;
	readonly disabled: boolean;
	readonly onName: (name: string) => void;
	readonly onSecret: (secret: boolean) => void;
}) => (
	<>
		<label className="mete-tool-field" htmlFor={`${id}-credential-name`}>
			{nls.localize(
				"mete/tools/credentialFieldName",
				"Environment variable or header name",
			)}
			<input
				id={`${id}-credential-name`}
				className="mete-field"
				value={name}
				disabled={disabled}
				required
				onChange={(event) => onName(event.currentTarget.value)}
			/>
		</label>
		<label>
			<input
				type="checkbox"
				checked={secret}
				disabled={disabled}
				onChange={(event) => onSecret(event.currentTarget.checked)}
			/>
			{nls.localize("mete/tools/credentialSecret", "Secret value")}
		</label>
	</>
);

/** Lifecycle belongs to the captured row, not to a render or a display-name match. */
export const McpConnectionRow = (props: {
	readonly session: McpConnectionSession;
	readonly target?: McpConnectionTarget | undefined;
	readonly disabled: boolean;
	readonly status: McpTestState;
	readonly dirty: boolean;
}) => {
	const { session, target, disabled, status, dirty } = props;
	const key = JSON.stringify(target);
	const latest = useRef(target);
	latest.current = target;
	useEffect(() => {
		const captured =
			JSON.stringify(latest.current) === key ? latest.current : undefined;
		void (captured ? session.show(captured) : session.clear());
		return () => {
			void session.clear();
		};
	}, [session, key]);
	if (!target)
		return (
			<>
				<McpConnectionStatus state={status} dirty={dirty} />
				<SaveConfigurationNote />
			</>
		);
	return (
		<McpConnectionView
			key={key}
			id={`mete-${target.expected.id}`}
			state={session.state}
			oauth={
				target.expected.transport !== "stdio" &&
				target.expected.auth === "oauth"
			}
			disabled={disabled}
			tested={status.kind === "done" && status.answer.ok}
			status={status}
			onType={(name, value) => session.type(name, value)}
			onRun={(op) => void session.run(op)}
			onSave={() => void session.save()}
			onAdd={(name, secret) => session.addField(name, secret)}
		/>
	);
};

const SaveConfigurationNote = () => (
	<p className="mete-tools-note">
		{nls.localize(
			"mete/tools/saveBeforeCredentials",
			"Save the server configuration before setting credentials or signing in.",
		)}
	</p>
);
