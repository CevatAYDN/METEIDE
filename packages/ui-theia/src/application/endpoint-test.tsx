import type { ModelInfo } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { EndpointTest } from "../domain/status-service.js";
import { customId } from "./endpoint-key.js";
import { Icon } from "./roster-look.js";

// A custom endpoint's Test on its card (ADR-087): "Test…" lists the models METE loaded for it, the
// user picks some, and "Test" sends one probe per picked model, only on that click (docs/09). A model
// runs skip whatever the settings is marked (ADR-154).

/** A model no run chooses: a context window of 0 fits no tier, and one neither free nor priced is a
 * candidate in no model mode (docs/09); a models row of the endpoint gives those facts. */
export const runsSkip = (m: ModelInfo) =>
	m.contextWindow === 0 || (!m.free && m.price === undefined);

/** One endpoint's Test, from nothing asked yet to the probes' results. */
export type EndpointTestState =
	| { readonly kind: "idle" | "loading" | "not_loaded" }
	| { readonly kind: "failed"; readonly text: string }
	| {
			readonly kind: "listed";
			readonly models: readonly string[];
			/** The listed models runs skip (ADR-154). */
			readonly skipped: readonly string[];
			readonly picked: readonly string[];
			readonly testing: boolean;
			readonly results?: EndpointTest["results"];
			/** Why the last Test could not be asked. */
			readonly problem?: string;
	  };

/** The Tests of the card's endpoints, and what they ask the widget for. */
export type EndpointTestsView = {
	readonly stateOf: (slug: string) => EndpointTestState;
	readonly onList: (slug: string) => void;
	readonly onPick: (slug: string, model: string, on: boolean) => void;
	readonly onProbe: (slug: string) => void;
};

type Listed = Extract<EndpointTestState, { kind: "listed" }>;

const resultText = (r: EndpointTest["results"][number]) =>
	r.ok
		? nls.localize("mete/settings/probeOk", "ok, {0} ms", String(r.ms))
		: [r.failed.code, r.failed.status, r.failed.message]
				.filter((p) => p !== undefined)
				.join(" ");

const ModelRow = ({
	slug,
	model,
	state,
	tests,
}: {
	readonly slug: string;
	readonly model: string;
	readonly state: Listed;
	readonly tests: EndpointTestsView;
}) => {
	const result = state.results?.find((r) => r.modelId === model);
	return (
		<label className="mete-endpoint-pick">
			<input
				type="checkbox"
				checked={state.picked.includes(model)}
				onChange={(e) => tests.onPick(slug, model, e.target.checked)}
			/>
			<span className="mete-endpoint-model">{model}</span>
			{state.skipped.includes(model) ? (
				<span className="mete-endpoint-result skip">
					{nls.localize("mete/settings/runsSkip", "runs skip it")}
				</span>
			) : null}
			{result ? (
				<span className={`mete-endpoint-result ${result.ok ? "good" : "bad"}`}>
					<Icon name={result.ok ? "check" : "close"} />
					{resultText(result)}
				</span>
			) : null}
		</label>
	);
};

const ListedModels = ({
	slug,
	state,
	tests,
}: {
	readonly slug: string;
	readonly state: Listed;
	readonly tests: EndpointTestsView;
}) => (
	<div className="mete-endpoint-models">
		{state.models.length === 0 ? (
			<p>
				{nls.localize(
					"mete/settings/noModels",
					"The endpoint lists no models.",
				)}
			</p>
		) : null}
		{state.skipped.length > 0 ? (
			<p>
				{nls.localize(
					"mete/settings/skipWhy",
					"Runs skip a model marked so: METE knows no context window for it, or it is neither free nor priced. A row for it under models: {0} in settings.yaml gives those facts.",
					`custom:${slug}`,
				)}
			</p>
		) : null}
		{state.models.map((m) => (
			<ModelRow key={m} slug={slug} model={m} state={state} tests={tests} />
		))}
		<div className="mete-endpoint-run">
			<button
				type="button"
				className="mete-button quiet"
				disabled={state.testing || state.picked.length === 0}
				onClick={() => tests.onProbe(slug)}
			>
				<Icon name={state.testing ? "loading" : "play"} spin={state.testing} />
				{state.testing
					? nls.localize("mete/settings/testing", "Testing…")
					: nls.localize("mete/settings/runTest", "Test")}
			</button>
		</div>
		{state.problem ? <p role="alert">{state.problem}</p> : null}
	</div>
);

// not_found is the only refusal the daemon sends for these requests, so refused means not loaded.
const stateLine = (slug: string, state: EndpointTestState) => {
	if (state.kind === "not_loaded")
		return nls.localize(
			"mete/settings/notLoaded",
			"METE has not loaded {0}: save it, set its API key and press Apply now.",
			`custom:${slug}`,
		);
	return state.kind === "failed" ? state.text : undefined;
};

/** The Test of one endpoint. */
export const TestPanel = ({
	slug,
	tests,
}: {
	readonly slug: string;
	readonly tests: EndpointTestsView;
}) => {
	const state = tests.stateOf(slug);
	const line = stateLine(slug, state);
	return (
		<div className="mete-endpoint-test">
			<div className="mete-endpoint-list">
				<button
					type="button"
					className="mete-button quiet"
					disabled={!customId(slug) || state.kind === "loading"}
					onClick={() => tests.onList(slug)}
				>
					<Icon name="beaker" />
					{nls.localize("mete/settings/testEndpoint", "Test…")}
				</button>
			</div>
			{line ? <p role="alert">{line}</p> : null}
			{state.kind === "listed" ? (
				<ListedModels slug={slug} state={state} tests={tests} />
			) : null}
		</div>
	);
};
