import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import type { ProviderKey } from "../domain/provider-keys.js";
import type { DaemonFailure } from "../domain/status-service.js";
import { type EndpointKeysView, KeyField } from "./endpoint-key.js";
import { LINK, MUTED, PANEL, ROW, TITLE } from "./look.js";
import {
	type FormActions,
	type FormState,
	SettingsForm,
} from "./settings-form.js";
import { failureText } from "./status-text.js";

// The onboarding wizard of docs/13 as the Welcome screen (ADR-088): language, model provider keys,
// privacy and web search on one page, in docs/13's order, then "Start a run".

/** What the screen draws: the providers `mete key list` names. */
export type WelcomeModel =
	| { readonly kind: "loading" }
	| { readonly kind: "failed"; readonly failure: DaemonFailure }
	| { readonly kind: "keys"; readonly keys: readonly ProviderKey[] };

/** The privacy form, or that no folder is open to learn the global file from. */
export type WelcomePrivacy =
	| { readonly kind: "no_folder" }
	| {
			readonly kind: "form";
			readonly state: FormState;
			readonly actions: FormActions;
			readonly canSaveGlobally: boolean;
	  };

export type WelcomeActions = {
	readonly onLanguage: () => void;
	readonly onKeyPage: (url: string) => void;
	readonly onStart: () => void;
};

// shortcut: a custom:<slug> key does not count, since `mete key list` names only built-in providers.
/** No model provider has a key, so the screen opens by itself (ADR-088). */
export const needsWelcome = (keys: readonly ProviderKey[]) =>
	!keys.some((k) => k.kind === "model" && k.set);

const Step = ({
	title,
	lead,
	children,
}: {
	readonly title: string;
	readonly lead: string;
	readonly children?: ReactNode;
}) => (
	<section className="mete-card" aria-label={title}>
		<h3 style={TITLE}>{title}</h3>
		<p style={MUTED}>{lead}</p>
		{children}
	</section>
);

const ProviderRow = ({
	provider,
	keys,
	onKeyPage,
}: {
	readonly provider: ProviderKey;
	readonly keys: EndpointKeysView;
	readonly onKeyPage: (url: string) => void;
}) => (
	<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
		<div style={ROW}>
			<strong>{provider.id}</strong>
			<span style={MUTED}>
				{provider.set
					? nls.localize("mete/key/hasKey", "key set")
					: nls.localize("mete/key/noKey", "no key")}
			</span>
			<button
				type="button"
				style={LINK}
				title={provider.keyPage}
				onClick={() => onKeyPage(provider.keyPage)}
			>
				{nls.localize("mete/welcome/getKey", "Get a key")}
			</button>
		</div>
		<KeyField
			id={`mete-welcome-${provider.id}`}
			name={provider.id}
			keys={keys}
			locked={false}
		/>
	</div>
);

const PrivacyStep = ({
	privacy,
}: {
	readonly privacy?: WelcomePrivacy | undefined;
}) => (
	<Step
		title={nls.localize("mete/welcome/privacy", "3. Privacy")}
		lead={nls.localize(
			"mete/welcome/privacyLead",
			"Providers that may train on your prompts stay out unless you let them in.",
		)}
	>
		{privacy?.kind === "no_folder" ? (
			<p style={MUTED}>
				{nls.localize(
					"mete/welcome/privacyNoFolder",
					"They are off now; open a folder to change this in Settings.",
				)}
			</p>
		) : null}
		{privacy?.kind === "form" ? (
			<SettingsForm
				section="privacy"
				state={privacy.state}
				actions={privacy.actions}
				canSaveGlobally={privacy.canSaveGlobally}
			/>
		) : null}
	</Step>
);

const rowsOf = (
	kind: ProviderKey["kind"],
	providers: readonly ProviderKey[],
	keys: EndpointKeysView,
	onKeyPage: (url: string) => void,
) =>
	providers
		.filter((p) => p.kind === kind)
		.map((p) => (
			<ProviderRow key={p.id} provider={p} keys={keys} onKeyPage={onKeyPage} />
		));

const Steps = ({
	providers,
	keys,
	privacy,
	actions,
}: {
	readonly providers: readonly ProviderKey[];
	readonly keys: EndpointKeysView;
	readonly privacy?: WelcomePrivacy | undefined;
	readonly actions: WelcomeActions;
}) => (
	<>
		<Step
			title={nls.localize("mete/welcome/keys", "2. Model provider keys")}
			lead={nls.localize(
				"mete/welcome/keysLead",
				"Set at least one. A key stays in the operating system keychain and never in a file.",
			)}
		>
			{rowsOf("model", providers, keys, actions.onKeyPage)}
		</Step>
		<PrivacyStep privacy={privacy} />
		<Step
			title={nls.localize("mete/welcome/search", "4. Web search")}
			lead={nls.localize(
				"mete/welcome/searchLead",
				"Exa MCP searches the web without a key; a Tavily key is optional.",
			)}
		>
			{rowsOf("search", providers, keys, actions.onKeyPage)}
		</Step>
	</>
);

const Start = ({
	ready,
	onStart,
}: {
	readonly ready: boolean;
	readonly onStart: () => void;
}) => (
	<div style={ROW}>
		<button
			type="button"
			className="mete-button"
			disabled={!ready}
			onClick={onStart}
		>
			{nls.localize("mete/welcome/start", "Start a run")}
		</button>
		{ready ? null : (
			<span style={MUTED}>
				{nls.localize(
					"mete/welcome/startWaits",
					"Set a model provider's key first.",
				)}
			</span>
		)}
	</div>
);

/** The Welcome screen for a model. */
export const WelcomeView = ({
	model,
	keys,
	privacy,
	actions,
}: {
	readonly model: WelcomeModel;
	readonly keys: EndpointKeysView;
	readonly privacy?: WelcomePrivacy | undefined;
	readonly actions: WelcomeActions;
}) => (
	<section style={{ ...PANEL, maxWidth: "760px" }} aria-live="polite">
		<h2 style={TITLE}>
			{nls.localize("mete/welcome/title", "Welcome to METE")}
		</h2>
		<Step
			title={nls.localize("mete/welcome/language", "1. Language")}
			lead={nls.localize(
				"mete/welcome/languageLead",
				"METE speaks English and Turkish; METE starts again in the language you pick.",
			)}
		>
			<div style={ROW}>
				<button
					type="button"
					className="mete-button quiet"
					onClick={actions.onLanguage}
				>
					{nls.localize("mete/settings/language", "Display language")}
				</button>
			</div>
		</Step>
		{model.kind === "loading" ? (
			<p>
				{nls.localize("mete/welcome/loading", "Reading the provider keys…")}
			</p>
		) : null}
		{model.kind === "failed" ? (
			<p role="alert">{failureText(model.failure)}</p>
		) : null}
		{model.kind === "keys" ? (
			<>
				<Steps
					providers={model.keys}
					keys={keys}
					privacy={privacy}
					actions={actions}
				/>
				<Start ready={!needsWelcome(model.keys)} onStart={actions.onStart} />
			</>
		) : null}
	</section>
);
