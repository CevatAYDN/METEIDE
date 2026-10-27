import { TierSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { TIER_ICONS, tierLabel } from "./member-look.js";
import { Icon } from "./roster-look.js";

// A member's model tier as tiles (ADR-093): the plain label of ADR-089 with the tier id under it,
// since the team file keeps the id; the lenient draft may hold a tier the schema refuses, then none
// is pressed and the issues say why. Laid out by style/mete-team-form.css.

/** The tier tiles; the chosen one is pressed and carries a check. */
export const TierTiles = (props: {
	readonly value: string;
	readonly onEdit: (v: string) => void;
}) => (
	<fieldset className="mete-tiers">
		<legend>{nls.localize("mete/team/tier", "Model tier")}</legend>
		<div>
			{TierSchema.options.map((t) => (
				<button
					key={t}
					type="button"
					className="mete-tier"
					aria-pressed={props.value === t}
					onClick={() => props.onEdit(t)}
				>
					<span className="mete-tier-glyph">
						<Icon name={TIER_ICONS[t]} />
					</span>
					{props.value === t ? (
						<span className="mete-tier-check">
							<Icon name="check" />
						</span>
					) : null}
					<span className="mete-tier-text">
						<span>{tierLabel(t)}</span>
						<span>{t}</span>
					</span>
				</button>
			))}
		</div>
		<p>
			{nls.localize(
				"mete/team/tierHint",
				"A team names a tier, never a provider or model: the providers that serve each tier come from the gateway settings.",
			)}
		</p>
	</fieldset>
);
