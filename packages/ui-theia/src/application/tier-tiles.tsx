import { TierSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { FIELD } from "./fields.js";
import { MUTED, ROW } from "./look.js";
import { TIER_ICONS, tierLabel } from "./member-look.js";
import { Icon } from "./roster-look.js";

// A member's model tier as tiles (ADR-093): the plain label of ADR-089 with the tier id beside it,
// since the team file keeps the id; the lenient draft may hold a tier the schema refuses, then none
// is pressed and the issues say why.

const GROUP = { ...FIELD, border: 0, padding: 0, margin: 0, minWidth: 0 };

/** The tier tiles; the chosen one is pressed. */
export const TierTiles = (props: {
	readonly value: string;
	readonly onEdit: (v: string) => void;
}) => (
	<fieldset style={GROUP}>
		<legend style={{ padding: 0 }}>
			{nls.localize("mete/team/tier", "Model tier")}
		</legend>
		<div style={ROW}>
			{TierSchema.options.map((t) => (
				<button
					key={t}
					type="button"
					className="mete-button quiet"
					aria-pressed={props.value === t}
					onClick={() => props.onEdit(t)}
				>
					<Icon name={TIER_ICONS[t]} /> {tierLabel(t)}{" "}
					{/* Fainter, not muted: a muted colour is unreadable on the pressed tile's accent. */}
					<span style={{ opacity: 0.7 }}>{t}</span>
				</button>
			))}
		</div>
		<span style={MUTED}>
			{nls.localize(
				"mete/team/tierHint",
				"A team names a tier, never a provider or model: the providers that serve each tier come from the gateway settings.",
			)}
		</span>
	</fieldset>
);
