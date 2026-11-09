import { nls } from "@theia/core/lib/common/nls";
import { z } from "zod";
import { type OnEdit, Tick } from "./fields.js";

const command = z.object({ run: z.string(), optional: z.boolean().optional() });
const V1Notice = () => (
	<p className="mete-wide">
		{nls.localize(
			"mete/team/verificationV1",
			"mete/v1: all checks are required in new runs. Optional checks require mete/v2.",
		)}
	</p>
);
const commandRows = (gates: readonly unknown[]) =>
	gates.flatMap((gate, index) => {
		const parsed = command.safeParse(gate);
		return parsed.success ? [{ ...parsed.data, index }] : [];
	});

/** Optional command checks edit exact v2 YAML positions; v1 is never migrated implicitly. */
export const CommandGateOptions = ({
	version,
	gates,
	base,
	onEdit,
}: {
	readonly version: string;
	readonly gates: readonly unknown[];
	readonly base: readonly (string | number)[];
	readonly onEdit: OnEdit;
}) => {
	if (version === "mete/v1") return <V1Notice />;
	if (version !== "mete/v2") return null;
	const rows = commandRows(gates);
	if (rows.length === 0) return null;
	return (
		<fieldset className="mete-wide mete-command-options">
			<legend>
				{nls.localize("mete/team/optionalCommands", "Optional command checks")}
			</legend>
			{rows.map((row) => (
				<Tick
					key={row.index}
					label={nls.localize(
						"mete/team/optionalCommand",
						"Gate {0}: {1} (optional)",
						row.index + 1,
						row.run,
					)}
					checked={row.optional === true}
					onChange={(value) =>
						onEdit([...base, "verify", row.index, "optional"], value)
					}
				/>
			))}
		</fieldset>
	);
};
