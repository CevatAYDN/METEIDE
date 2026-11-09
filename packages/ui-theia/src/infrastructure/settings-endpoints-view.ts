import type { ProviderState } from "@mete/contracts";
import type { EndpointsActions } from "../application/endpoints-card.js";
import type { EndpointKeys } from "./endpoint-keys.js";
import type { EndpointTests } from "./endpoint-tests.js";
import type { EndpointsForm } from "./endpoints-form.js";

type Options = {
	readonly form: () => EndpointsForm | undefined;
	readonly keys: EndpointKeys | undefined;
	readonly tests: EndpointTests | undefined;
	readonly states: readonly ProviderState[] | undefined;
	readonly activeRuns: number;
};

// Read the current list on each edit; two keystrokes can precede a redraw.
const keyedActions = (
	actions: EndpointsActions,
	keys: EndpointKeys,
	form: Options["form"],
): EndpointsActions => {
	const slugAt = (index: number) =>
		form()?.form()?.state.list[index]?.slug ?? "";
	return {
		...actions,
		onEdit: (index, field, value) => {
			if (field === "slug") keys.rename(slugAt(index), value);
			actions.onEdit(index, field, value);
		},
		onRemove: (index) => {
			keys.forget(slugAt(index));
			actions.onRemove(index);
		},
	};
};

/** Endpoint presentation retains live key/edit callbacks and existing test state. */
export const settingsEndpointsView = (opts: Options) => {
	const form = opts.form()?.form();
	const { keys, tests } = opts;
	if (!form || !keys || !tests) return form;
	return {
		state: form.state,
		actions: keyedActions(form.actions, keys, opts.form),
		states: opts.states,
		keys: {
			stateOf: (slug: string) => keys.stateOf(slug),
			onType: (slug: string, key: string) => keys.type(slug, key),
			onSet: (slug: string) => void keys.set(slug),
			activeRuns: opts.activeRuns,
		},
		tests: {
			stateOf: (slug: string) => tests.stateOf(slug),
			onList: (slug: string) => void tests.list(slug),
			onPick: (slug: string, model: string, on: boolean) =>
				tests.pick(slug, model, on),
			onProbe: (slug: string) => void tests.probe(slug),
		},
	};
};
