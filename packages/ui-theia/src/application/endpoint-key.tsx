import { CustomProviderIdSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { Icon } from "./roster-look.js";

// A custom endpoint's API key field on its card (ADR-087): a masked field that is never filled from
// the keychain, and Set key, which waits while a run of the folder is queued or running.

/** One endpoint's typed key, whether it is being set, and how that went. */
export type EndpointKey = {
	readonly key: string;
	readonly busy: boolean;
	readonly note?:
		| { readonly kind: "saved" | "refused"; readonly text: string }
		| undefined;
};

/** The keys of the card's endpoints, and what they ask the widget for. */
export type EndpointKeysView = {
	readonly stateOf: (slug: string) => EndpointKey;
	readonly onType: (slug: string, key: string) => void;
	readonly onSet: (slug: string) => void;
	/** Runs of the folder that are queued or running; a key waits for them (ADR-061). */
	readonly activeRuns: number;
};

/** The provider id of a slug, or undefined when the slug cannot be one. */
export const customId = (slug: string) => {
	const id = `custom:${slug}`;
	return CustomProviderIdSchema.safeParse(id).success ? id : undefined;
};

/** The key field and Set key of one endpoint, or of a provider on the Welcome screen (ADR-088). */
export const KeyField = ({
	id,
	name,
	keys,
	locked,
}: {
	readonly id: string;
	/** What the keys are kept by: an endpoint's slug, or a provider's id. */
	readonly name: string;
	readonly keys: EndpointKeysView;
	/** Set key is off for a reason outside the field, such as edits a restart would drop. */
	readonly locked: boolean;
}) => {
	const state = keys.stateOf(name);
	const off = locked || !state.key.trim() || state.busy || keys.activeRuns > 0;
	return (
		// Classes, not inline styles, so a screen can lay the parts out as its board draws them
		// (style/mete-form.css; the Welcome screen's rows in mete-welcome.css).
		<div className="mete-key-field">
			<label htmlFor={id}>
				{nls.localize("mete/settings/apiKey", "API key")}
			</label>
			<div className="mete-key-entry">
				<input
					id={id}
					className="mete-field"
					type="password"
					autoComplete="off"
					value={state.key}
					onChange={(e) => keys.onType(name, e.target.value)}
				/>
				<button
					type="button"
					className="mete-button"
					disabled={off}
					onClick={() => keys.onSet(name)}
				>
					<Icon name="key" />
					{nls.localize("mete/settings/setEndpointKey", "Set key")}
				</button>
			</div>
			{keys.activeRuns > 0 ? (
				<span className="mete-key-note">
					{nls.localize(
						"mete/settings/keyWaits",
						"A run is running; setting a key restarts METE, so it waits until the run is paused or ends.",
					)}
				</span>
			) : null}
			{state.note ? (
				<p role={state.note.kind === "refused" ? "alert" : undefined}>
					{state.note.text}
				</p>
			) : null}
		</div>
	);
};
