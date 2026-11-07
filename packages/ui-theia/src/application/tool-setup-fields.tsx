import { nls } from "@theia/core/lib/common/nls";
import type { ToolSetup, ToolSetupError } from "./tool-setup.js";

/** Controlled guided fields; the wrapper owns focus and submission. */
export type ToolSetupFieldsProps = {
	readonly input: ToolSetup;
	readonly onChange: (input: ToolSetup) => void;
	readonly error?: ToolSetupError | undefined;
};

const fieldId = (name: string) => `mete-tool-setup-${name}`;
const modes = () =>
	[
		["remote", nls.localize("mete/tools/remote", "Remote URL")],
		["local", nls.localize("mete/tools/local", "Local command")],
		["import", nls.localize("mete/tools/import", "Import JSON")],
	] as const;

const Field = ({
	name,
	label,
	props,
	multiline = false,
	required = true,
}: {
	readonly name: keyof Omit<ToolSetup, "mode">;
	readonly label: string;
	readonly props: ToolSetupFieldsProps;
	readonly multiline?: boolean;
	readonly required?: boolean;
}) => {
	const error = props.error?.field === name ? props.error : undefined;
	const attributes = {
		id: fieldId(name),
		className: "mete-field",
		required,
		value: props.input[name] ?? "",
		"aria-invalid": !!error,
		"aria-describedby": error ? `${fieldId(name)}-error` : undefined,
		onChange: (e: { target: { value: string } }) =>
			props.onChange({ ...props.input, [name]: e.target.value }),
	};
	return (
		<div className="mete-tool-field">
			<label htmlFor={fieldId(name)}>{label}</label>
			{multiline ? (
				<textarea {...attributes} rows={3} />
			) : (
				<input {...attributes} />
			)}
			{error ? (
				<span id={`${fieldId(name)}-error`} role="alert">
					{error.text}
				</span>
			) : null}
		</div>
	);
};

const Choice = ({
	name,
	label,
	options,
	props,
	required = true,
}: {
	readonly name: "httpMode" | "runtime";
	readonly label: string;
	readonly options: readonly (readonly [string, string])[];
	readonly props: ToolSetupFieldsProps;
	readonly required?: boolean;
}) => (
	<div className="mete-tool-field">
		<label htmlFor={fieldId(name)}>{label}</label>
		<select
			id={fieldId(name)}
			className="mete-field"
			required={required}
			value={props.input[name] ?? ""}
			aria-invalid={props.error?.field === name}
			aria-describedby={
				props.error?.field === name ? `${fieldId(name)}-error` : undefined
			}
			onChange={(e) =>
				props.onChange({ ...props.input, [name]: e.target.value })
			}
		>
			<option value="">
				{nls.localize("mete/settings/choose", "Choose…")}
			</option>
			{options.map(([value, text]) => (
				<option key={value} value={value}>
					{text}
				</option>
			))}
		</select>
		{props.error?.field === name ? (
			<span id={`${fieldId(name)}-error`} role="alert">
				{props.error.text}
			</span>
		) : null}
	</div>
);

const LocalFields = (props: ToolSetupFieldsProps) => (
	<>
		<Field
			name="command"
			label={nls.localize("mete/tools/program", "Program")}
			props={props}
		/>
		<Field
			name="args"
			label={nls.localize("mete/settings/args", "Arguments, one per line")}
			props={props}
			multiline
			required={false}
		/>
		{["npx", "uvx"].includes(props.input.command?.trim() ?? "") ? null : (
			<Choice
				name="runtime"
				label={nls.localize("mete/settings/runtime", "Runtime")}
				options={[
					["node", "Node.js"],
					["python", "Python"],
					["container", "Container"],
				]}
				props={props}
			/>
		)}
	</>
);

/** Familiar modes with explicit HTTP selection and argument-array input, never a shell command. */
const SetupModes = (props: ToolSetupFieldsProps) => (
	<fieldset
		className="mete-tool-modes"
		aria-label={nls.localize("mete/tools/setupMode", "Connection method")}
	>
		{modes().map(([mode, label]) => (
			<button
				key={mode}
				type="button"
				className="mete-button quiet"
				aria-pressed={props.input.mode === mode}
				onClick={() => props.onChange({ ...props.input, mode })}
			>
				{label}
			</button>
		))}
	</fieldset>
);

const RemoteFields = (props: ToolSetupFieldsProps) => (
	<>
		<Field
			name="url"
			label={nls.localize("mete/tools/address", "Address")}
			props={props}
		/>
		<Choice
			name="httpMode"
			label={nls.localize("mete/tools/httpMode", "HTTP mode")}
			options={[
				["streamable-http", "Streamable HTTP"],
				["sse", "SSE"],
			]}
			props={props}
		/>
	</>
);

export const ToolSetupFields = (props: ToolSetupFieldsProps) => (
	<>
		<SetupModes {...props} />
		{props.input.mode === "import" ? (
			<>
				<Field
					name="json"
					label={nls.localize("mete/tools/json", "Server JSON")}
					props={props}
					multiline
				/>
				<Choice
					name="httpMode"
					label={nls.localize(
						"mete/tools/importHttpMode",
						"HTTP mode for URLs without a type",
					)}
					options={[
						["streamable-http", "Streamable HTTP"],
						["sse", "SSE"],
					]}
					props={props}
					required={false}
				/>
			</>
		) : (
			<>
				<Field
					name="id"
					label={nls.localize("mete/tools/displayId", "Display id")}
					props={props}
				/>
				{props.input.mode === "local" ? (
					<LocalFields {...props} />
				) : (
					<RemoteFields {...props} />
				)}
			</>
		)}
	</>
);
