import type {
	ProviderState,
	QuotaReserveAdapter,
	QuotaUsage,
} from "@mete/contracts";
import type { EventBus } from "@mete/kernel";
import { apiKeyName } from "@mete/providers";
import type { App } from "../infrastructure/app.js";

// Whether each provider can carry a run on now (ADR-050), from facts the CLI already has: the
// inactive modules and the keychain, the quota.exhausted events since the last quota.restored, and
// the gateway's usable models after the privacy rules and the model mode. The CLI's quota-pause lines
// and the daemon's mete/quota both read these states.

const PROVIDER = "provider.chat@2";
// provider-custom is set up with endpoints in models.yaml, not with a key, so it has no state here.
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

/** The state of each provider module. */
export const providerStates = async (
	app: App,
	until: (id: string) => string | undefined,
): Promise<ProviderState[]> => {
	const models = await app.models(AbortSignal.timeout(LISTING_TIMEOUT_MS));
	const usable = new Set(models.map((m) => m.providerId));
	const states: ProviderState[] = [];
	for (const moduleId of providerModules(app)) {
		const id = moduleId.slice("provider-".length);
		const resetsAt = until(id);
		if (app.inactive.some((m) => m.moduleId === moduleId))
			states.push(await inactiveState(app, id));
		else if (resetsAt) states.push({ id, state: "exhausted", resetsAt });
		else states.push({ id, state: usable.has(id) ? "ready" : "unusable" });
	}
	return states;
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
		return `${s.id}: none of its models can be used here (the privacy rules may leave them out: allowTraining in privacy.yaml; the model mode may: models in gateway.yaml; or its key was refused)`;
	return undefined;
};
