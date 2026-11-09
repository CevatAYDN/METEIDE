import { nls } from "@theia/core/lib/common/nls";
import { z } from "zod";
import type { OnEdit } from "./fields.js";
import { Icon } from "./roster-look.js";

type Props = {
	readonly gates: readonly unknown[];
	readonly base: readonly (string | number)[];
	readonly onEdit: OnEdit;
};
const command = z.object({ run: z.string() });
const rowsOf = (gates: readonly unknown[]) =>
	gates.flatMap((gate, index) => {
		const parsed = command.safeParse(gate);
		return parsed.success ? [{ run: parsed.data.run, index }] : [];
	});
const row = (
	gate: { readonly run: string; readonly index: number },
	props: Props,
) => {
	const label = nls.localize(
		"mete/team/commandGate",
		"Gate {0} command",
		gate.index + 1,
	);
	const remove = nls.localize(
		"mete/team/removeCommandGate",
		"Remove command gate {0}",
		gate.index + 1,
	);
	const path = [...props.base, "verify", gate.index];
	return (
		<div key={gate.index} className="mete-command-row">
			<label>
				{label}
				<input
					className="mete-field mono"
					value={gate.run}
					aria-label={label}
					onChange={(event) =>
						props.onEdit([...path, "run"], event.target.value)
					}
				/>
			</label>
			<button
				type="button"
				className="mete-button quiet icon"
				title={remove}
				aria-label={remove}
				onClick={() => props.onEdit(path, undefined)}
			>
				<Icon name="close" />
			</button>
		</div>
	);
};

/** Command edits address YAML nodes by gate position, preserving duplicate commands and comments. */
export const CommandGateFields = (props: Props) => {
	const add = nls.localize("mete/team/addCommandGate", "Add command check");
	return (
		<fieldset className="mete-wide mete-command-fields">
			<legend>
				{nls.localize(
					"mete/team/verifyCommands",
					"Verification commands (required unless marked optional)",
				)}
			</legend>
			{rowsOf(props.gates).map((gate) => row(gate, props))}
			<button
				type="button"
				className="mete-button quiet"
				aria-label={add}
				onClick={() =>
					props.onEdit([...props.base, "verify", props.gates.length], {
						run: "",
					})
				}
			>
				<Icon name="add" />
				{add}
			</button>
		</fieldset>
	);
};
