import type { ProviderState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import type { ProviderKey } from "../domain/provider-keys.js";
import type { DaemonFailure } from "../domain/status-service.js";
import { type EndpointKeysView, KeyField } from "./endpoint-key.js";
import { QUOTA_LOOK, stateText } from "./quota-text.js";
import { Icon } from "./roster-look.js";
import {
	type FormActions,
	type FormState,
	SettingsForm,
} from "./settings-form.js";
import { failureText } from "./status-text.js";

// The onboarding wizard of docs/13 as the Welcome screen (ADR-088): language, model provider keys,
// privacy and web search on one page, in docs/13's order, then "Start a run". The look is the design
// set's (ADR-128), in style/mete-welcome.css: a hero band with the first step beside the title, the
// keys under it, privacy and web search side by side, then the start bar. With a folder open, a keyed
// model provider's row says its state as mete/quota answers it, in the Quota screen's words (ADR-147).

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
	/** Reads the keys and the providers' states again. */
	readonly onCheck: () => void;
};

// shortcut: a custom:<slug> key does not count, since `mete key list` names only built-in providers.
/** No model provider has a key, so the screen opens by itself (ADR-088). */
export const needsWelcome = (keys: readonly ProviderKey[]) =>
	!keys.some((k) => k.kind === "model" && k.set);

// A step's card: its glyph's tile and its number and title, the lead under them. The heading names
// the region, so the number reads with the title ("1. Language").
const Step = ({
	n,
	icon,
	title,
	lead,
	children,
}: {
	readonly n: number;
	readonly icon: string;
	readonly title: string;
	readonly lead: string;
	readonly children?: ReactNode;
}) => (
	<section className="mete-welcome-step" aria-labelledby={`mete-step-${n}`}>
		<div className="mete-welcome-head">
			<span className="mete-welcome-tile">
				<Icon name={icon} />
			</span>
			<h3 id={`mete-step-${n}`}>
				<span className="mete-welcome-n">{`${n}.`}</span>
				{` ${title}`}
			</h3>
		</div>
		<p className="mete-welcome-lead">{lead}</p>
		{children}
	</section>
);

const KeyState = ({ set }: { readonly set: boolean }) => (
	<span className="mete-welcome-state" data-set={set}>
		{set
			? nls.localize("mete/key/hasKey", "key set")
			: nls.localize("mete/key/noKey", "no key")}
	</span>
);

// A refused key shows only when the provider's listing refused it; a call's refusal is not kept here.
const Health = ({ state }: { readonly state: ProviderState }) => (
	<p className={`mete-welcome-health ${QUOTA_LOOK[state.state].tone}`}>
		<Icon name={QUOTA_LOOK[state.state].icon} />
		{stateText(state)}
	</p>
);

const ProviderRow = ({
	provider,
	state,
	keys,
	onKeyPage,
}: {
	readonly provider: ProviderKey;
	readonly state?: ProviderState | undefined;
	readonly keys: EndpointKeysView;
	readonly onKeyPage: (url: string) => void;
}) => (
	<li className="mete-welcome-provider">
		<div className="mete-welcome-who">
			<strong>{provider.id}</strong>
			<span>
				<KeyState set={provider.set} />
				<button
					type="button"
					className="mete-welcome-ext"
					title={provider.keyPage}
					onClick={() => onKeyPage(provider.keyPage)}
				>
					{nls.localize("mete/welcome/getKey", "Get a key")}
					<Icon name="link-external" />
				</button>
			</span>
		</div>
		<KeyField
			id={`mete-welcome-${provider.id}`}
			name={provider.id}
			keys={keys}
			locked={false}
		/>
		{provider.set && state ? <Health state={state} /> : null}
	</li>
);

const PrivacyStep = ({
	privacy,
}: {
	readonly privacy?: WelcomePrivacy | undefined;
}) => (
	<Step
		n={3}
		icon="shield"
		title={nls.localize("mete/welcome/privacy", "Privacy")}
		lead={nls.localize(
			"mete/welcome/privacyLead",
			"Providers that may train on your prompts stay out unless you let them in.",
		)}
	>
		{privacy?.kind === "no_folder" ? (
			<p className="mete-welcome-lead">
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

// A model provider's row lays its name, field and Set key out on one line; the search one stacks.
const rowsOf = (
	kind: ProviderKey["kind"],
	{ providers, states, keys, actions }: StepsProps,
) => (
	<ul className="mete-welcome-providers" data-kind={kind}>
		{providers
			.filter((p) => p.kind === kind)
			.map((p) => (
				<ProviderRow
					key={p.id}
					provider={p}
					state={states?.find((s) => s.id === p.id)}
					keys={keys}
					onKeyPage={actions.onKeyPage}
				/>
			))}
	</ul>
);

type StepsProps = {
	readonly providers: readonly ProviderKey[];
	/** The providers' states in the open folder; none without a folder or an answer. */
	readonly states?: readonly ProviderState[] | undefined;
	readonly keys: EndpointKeysView;
	readonly privacy?: WelcomePrivacy | undefined;
	readonly actions: WelcomeActions;
};

const Steps = (props: StepsProps) => (
	<>
		<Step
			n={2}
			icon="key"
			title={nls.localize("mete/welcome/keys", "Model provider keys")}
			lead={nls.localize(
				"mete/welcome/keysLead",
				"Set at least one. A key stays in the operating system keychain and never in a file.",
			)}
		>
			{rowsOf("model", props)}
			{props.states ? (
				<div className="mete-welcome-check">
					<button
						type="button"
						className="mete-button quiet"
						onClick={props.actions.onCheck}
					>
						<Icon name="refresh" />
						{nls.localize("mete/welcome/check", "Check again")}
					</button>
				</div>
			) : null}
		</Step>
		<div className="mete-welcome-pair">
			<PrivacyStep privacy={props.privacy} />
			<Step
				n={4}
				icon="search"
				title={nls.localize("mete/welcome/search", "Web search")}
				lead={nls.localize(
					"mete/welcome/searchLead",
					"Exa MCP searches the web without a key; a Tavily key is optional.",
				)}
			>
				{rowsOf("search", props)}
			</Step>
		</div>
	</>
);

const Start = ({
	ready,
	onStart,
}: {
	readonly ready: boolean;
	readonly onStart: () => void;
}) => (
	<div className="mete-welcome-start">
		<button
			type="button"
			className="mete-button"
			disabled={!ready}
			onClick={onStart}
		>
			<Icon name="play" />
			{nls.localize("mete/welcome/start", "Start a run")}
		</button>
		{ready ? null : (
			<p>
				<Icon name="info" />
				{nls.localize(
					"mete/welcome/startWaits",
					"Set a model provider's key first.",
				)}
			</p>
		)}
	</div>
);

// The hero band: the rocket, the title and what the screen is for, with the first step beside them.
const Hero = ({ onLanguage }: { readonly onLanguage: () => void }) => (
	<header className="mete-welcome-hero">
		<div className="mete-welcome-title">
			<span className="mete-welcome-rocket">
				<Icon name="rocket" />
			</span>
			<h2>{nls.localize("mete/welcome/title", "Welcome to METE")}</h2>
			<p>
				{nls.localize(
					"mete/welcome/caption",
					"METE: keys, privacy and web search to start with",
				)}
			</p>
		</div>
		<Step
			n={1}
			icon="globe"
			title={nls.localize("mete/welcome/language", "Language")}
			lead={nls.localize(
				"mete/welcome/languageLead",
				"METE speaks English and Turkish; METE starts again in the language you pick.",
			)}
		>
			<div>
				<button
					type="button"
					className="mete-button quiet"
					onClick={onLanguage}
				>
					<Icon name="globe" />
					{nls.localize("mete/settings/language", "Display language")}
				</button>
			</div>
		</Step>
	</header>
);

/** The Welcome screen for a model. */
export const WelcomeView = ({
	model,
	states,
	keys,
	privacy,
	actions,
}: {
	readonly model: WelcomeModel;
	readonly states?: readonly ProviderState[] | undefined;
	readonly keys: EndpointKeysView;
	readonly privacy?: WelcomePrivacy | undefined;
	readonly actions: WelcomeActions;
}) => (
	<section className="mete-welcome" aria-live="polite">
		<Hero onLanguage={actions.onLanguage} />
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
					states={states}
					keys={keys}
					privacy={privacy}
					actions={actions}
				/>
				<Start ready={!needsWelcome(model.keys)} onStart={actions.onStart} />
			</>
		) : null}
	</section>
);
