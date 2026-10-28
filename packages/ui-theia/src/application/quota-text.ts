import type { ProviderState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";

// The words of "METE: Quota" and of the Home lines under a run paused for quota, from the states
// mete/quota answers (ADR-050); the CLI's quota-pause lines say the same in English.

const asIs = (text: string) => text;

// One literal nls.localize call per state, so Theia's nls-extract can read each text.
const STATE: {
	readonly [S in ProviderState["state"]]: (
		id: string,
		s: Extract<ProviderState, { state: S }>,
	) => string;
} = {
	ready: (id) => nls.localize("mete/quota/ready", "{0}: ready", id),
	// "METE: Set provider key" lists the built-in providers only, so an endpoint's key is on its card.
	no_key: (id) =>
		id.startsWith("custom:")
			? nls.localize(
					"mete/quota/noKeyCustom",
					"{0}: no key (Settings, its endpoint card, Set key)",
					id,
				)
			: nls.localize(
					"mete/quota/noKey",
					"{0}: no key (METE: Set provider key)",
					id,
				),
	inactive: (id) =>
		nls.localize(
			"mete/quota/inactive",
			"{0}: not active; the log says why",
			id,
		),
	exhausted: (id, s) =>
		nls.localize(
			"mete/quota/exhausted",
			"{0}: its free quota is used up until {1}",
			id,
			new Date(s.resetsAt).toLocaleString(),
		),
	unusable: (id) =>
		nls.localize(
			"mete/quota/unusable",
			"{0}: none of its models can be used here (the privacy rules may leave them out: allowTraining in privacy.yaml; the model mode may: models in gateway.yaml; or its key was refused)",
			id,
		),
};

/** What one provider's state says; `prepare` readies the provider id, which came from outside. */
export const stateText = (s: ProviderState, prepare = asIs) =>
	(STATE[s.state] as (id: string, s: ProviderState) => string)(
		prepare(s.id),
		s,
	);

/** The states of every provider, for one message. */
export const quotaText = (
	providers: readonly ProviderState[],
	prepare = asIs,
) =>
	providers.length === 0
		? nls.localize("mete/quota/none", "METE has no provider modules.")
		: nls.localize(
				"mete/quota/states",
				"Providers: {0}",
				providers.map((s) => stateText(s, prepare)).join("; "),
			);

/**
 * A provider state's look in the METE view (ADR-109, ADR-128): its tone, and the glyph its quota
 * chip shows, so a missing key and a used-up quota differ by more than their tooltip.
 */
export const QUOTA_LOOK: {
	readonly [S in ProviderState["state"]]: {
		readonly tone: "good" | "warn" | "bad";
		readonly icon: string;
	};
} = {
	ready: { tone: "good", icon: "check" },
	no_key: { tone: "warn", icon: "key" },
	exhausted: { tone: "warn", icon: "clock" },
	inactive: { tone: "bad", icon: "close" },
	unusable: { tone: "bad", icon: "circle-slash" },
};
