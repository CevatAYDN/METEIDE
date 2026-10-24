import { CustomProviderIdSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { MUTED, ROW } from "./look.js";

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

/** The key field and Set key of one endpoint. */
export const KeyField = ({
	id,
	slug,
	keys,
	unsaved,
}: {
	readonly id: string;
	readonly slug: string;
	readonly keys: EndpointKeysView;
	/** The card has edits that are not saved; a restart would drop them. */
	readonly unsaved: boolean;
}) => {
	const state = keys.stateOf(slug);
	const off =
		unsaved ||
		!customId(slug) ||
		!state.key.trim() ||
		state.busy ||
		keys.activeRuns > 0;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
			<label htmlFor={id}>
				{nls.localize("mete/settings/apiKey", "API key")}
			</label>
			<div style={ROW}>
				<input
					id={id}
					className="mete-field"
					type="password"
					autoComplete="off"
					value={state.key}
					onChange={(e) => keys.onType(slug, e.target.value)}
				/>
				<button
					type="button"
					className="mete-button"
					disabled={off}
					onClick={() => keys.onSet(slug)}
				>
					{nls.localize("mete/settings/setEndpointKey", "Set key")}
				</button>
			</div>
			{keys.activeRuns > 0 ? (
				<span style={MUTED}>
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
