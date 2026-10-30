import {
	type ProviderAdapter,
	type ProviderState,
	ProvidersConfigSchema,
	type QuotaReserveAdapter,
	type QuotaUsage,
} from "@mete/contracts";
import { type EventBus, mergedSection } from "@mete/kernel";
import { apiKeyName } from "@mete/providers";
import type { App } from "../infrastructure/app.js";

// Whether each provider can carry a run on now (ADR-050), from facts the CLI already has: the
// inactive modules and the keychain, the quota.exhausted events since the last quota.restored, and
// the gateway's usable models after the privacy rules and the model mode. The CLI's quota-pause lines
// and the daemon's mete/quota both read these states. The custom endpoints follow the modules, one
// state each (ADR-154).

const PROVIDER = "provider.chat@2";
// provider-custom has many endpoints, so each of them has a state, not the module.
const CUSTOM = "provider-custom";
// The gateway's listing is cached; this only bounds a first listing that hangs.
export const LISTING_TIMEOUT_MS = 10_000;

const providerModules = (app: App) =>
	app.modules
		.filter(
			(m) => m.manifest.provides.includes(PROVIDER) && m.manifest.id !== CUSTOM,
		)
		.map((m) => m.manifest.id);

const inactiveState = async (app: App, id: string): Promise<ProviderState> => {
	const key = await app.secrets.get(apiKeyName(id));
	return { id, state: key.ok && !key.value ? "no_key" : "inactive" };
};

/** The providers whose quota is spent, with when it opens again; only resets still ahead count. */
export const trackExhausted = (events: EventBus, now = Date.now) => {
	const spent = new Map<string, string>();
	const subs = [
		events.subscribe("quota.exhausted", (e) => {
			spent.set(e.payload.providerId, e.payload.resetsAt);
		}),
		events.subscribe("quota.restored", (e) => {
			spent.delete(e.payload.providerId);
		}),
	];
	return {
		until: (id: string) => {
			const at = spent.get(id);
			return at && Date.parse(at) > now() ? at : undefined;
		},
		dispose: () => {
			for (const s of subs) s.dispose();
		},
	};
};

const activeState = (
	id: string,
	until: (id: string) => string | undefined,
	usable: ReadonlySet<string>,
): ProviderState => {
	const resetsAt = until(id);
	if (resetsAt) return { id, state: "exhausted", resetsAt };
	return { id, state: usable.has(id) ? "ready" : "unusable" };
};

// Each endpoint of the providers section the modules loaded: one whose adapter is registered is
// active; provider-custom skips one without its key, and a section that does not parse lists none.
const customStates = async (
	app: App,
	until: (id: string) => string | undefined,
	usable: ReadonlySet<string>,
): Promise<ProviderState[]> => {
	const config = ProvidersConfigSchema.safeParse(
		mergedSection(app.config.layers, "providers"),
	);
	if (!config.success) return [];
	const adapters = app.registry.resolve<ProviderAdapter>(PROVIDER);
	const registered = new Set(
		adapters.ok ? adapters.value.map((a) => a.impl.id) : [],
	);
	const states: ProviderState[] = [];
	for (const { slug } of config.data.custom) {
		const id = `custom:${slug}`;
		states.push(
			registered.has(id)
				? activeState(id, until, usable)
				: await inactiveState(app, id),
		);
	}
	return states;
};

/** The state of each provider module, then of each custom endpoint (ADR-154). */
export const providerStates = async (
	app: App,
	until: (id: string) => string | undefined,
): Promise<ProviderState[]> => {
	const models = await app.models(AbortSignal.timeout(LISTING_TIMEOUT_MS));
	const usable = new Set(models.map((m) => m.providerId));
	const states: ProviderState[] = [];
	for (const moduleId of providerModules(app)) {
		const id = moduleId.slice("provider-".length);
		states.push(
			app.inactive.some((m) => m.moduleId === moduleId)
				? await inactiveState(app, id)
				: activeState(id, until, usable),
		);
	}
	return [...states, ...(await customStates(app, until, usable))];
};

/** The quota pool's units with their history (ADR-054, ADR-055); none when the quota module is not active. */
export const quotaUnits = (app: App): QuotaUsage[] => {
	const quota = app.registry.resolve<QuotaReserveAdapter>("quota.reserve@4");
	if (!quota.ok) return [];
	return [...quota.value[0].impl.usage()];
};

/** The line a terminal prints for a provider that cannot help now; none for a ready one. */
export const stateLine = (s: ProviderState): string | undefined => {
	if (s.state === "no_key") return `${s.id}: no key (mete key set ${s.id})`;
	if (s.state === "inactive") return `${s.id}: not active; the log says why`;
	if (s.state === "exhausted")
		return `${s.id}: its free quota is used up until ${new Date(s.resetsAt).toLocaleString()}`;
	if (s.state === "unusable")
		return `${s.id}: none of its models can be used here (its model list did not load or its key was refused: the log says which; or the privacy rules leave them out: allowTraining in privacy.yaml; or the model mode does: models in gateway.yaml)`;
	return undefined;
};
