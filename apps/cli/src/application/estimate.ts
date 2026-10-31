import {
	type ModelRef,
	ModelRefSchema,
	type Pins,
	pinOf,
	type RunPrefer,
} from "@mete/contracts";
import {
	estimateRequests,
	listTemplates,
	readPins,
	type SeatEntry,
} from "@mete/core";
import type { App } from "../infrastructure/app.js";
import { LISTING_TIMEOUT_MS, providerStates } from "./provider-states.js";

// The composer's request estimate (ADR-068): core counts the template's requests per seat; each
// seat's requests go to the first provider of its chain whose state is ready, as the scheduler
// picks at call time (docs/09, Scheduler, step 2), and to nobody when none is; query embeddings go
// to the embedding chain's (ADR-152). The run's own model
// choice leads a seat's chain, else its role's pin, as in the run (ADR-122, ADR-077, ADR-155); a pins
// file that cannot be used counts as none.

const isRef = (p: RunPrefer): p is ModelRef =>
	ModelRefSchema.safeParse(p).success;

// What the run takes of its choice (core's runPreferOf): one model for the single agent, one per
// role for a team; the other shape counts as none.
const runChoice = (
	prefer: RunPrefer | undefined,
	team: boolean,
	roleId: string | undefined,
) => {
	if (!prefer) return undefined;
	if (isRef(prefer)) return team ? undefined : prefer;
	return roleId ? prefer[roleId] : undefined;
};

const seatChain = (app: App, seat: SeatEntry, prefer: ModelRef | undefined) =>
	app.chain(
		{ tier: seat.tier },
		{ needs: [...seat.needs], ...(prefer ? { prefer } : {}) },
		AbortSignal.timeout(LISTING_TIMEOUT_MS),
	);

// A query is embedded only by the lessons search of knowledge.search@1 (ADR-151, ADR-152).
const embedChainOf = async (app: App) =>
	app.registry.has("knowledge.search@1")
		? app.embedChain(AbortSignal.timeout(LISTING_TIMEOUT_MS))
		: [];

/** Requests per provider for a template, or a single agent when `templateId` is null; undefined for a template that does not load. */
export const estimateFor = async (
	app: App,
	templateId: string | null,
	until: (id: string) => string | undefined,
	choice?: RunPrefer,
): Promise<
	| {
			providers: { providerId: string; requests: number }[];
			unassigned: number;
	  }
	| undefined
> => {
	const { templates } = await listTemplates(app.templates);
	const template =
		templateId === null
			? null
			: templates.find((t) => t.metadata.id === templateId);
	if (template === undefined) return undefined;
	const states = await providerStates(app, until);
	const ready = new Set(
		states.filter((s) => s.state === "ready").map((s) => s.id),
	);
	const pins: Pins = await readPins(app.templates.workspace).then((r) =>
		r.ok ? r.value : {},
	);
	const pinned = (roleId: string | undefined) =>
		template && roleId ? pinOf(pins, template.metadata.id, roleId) : undefined;
	const embedding = await embedChainOf(app);
	const totals = new Map<string, number>();
	let unassigned = 0;
	for (const e of estimateRequests(template, embedding.length > 0)) {
		const chain =
			"embed" in e
				? embedding
				: await seatChain(
						app,
						e,
						runChoice(choice, template !== null, e.roleId) ?? pinned(e.roleId),
					);
		const first = chain.find((m) => ready.has(m.providerId))?.providerId;
		if (first) totals.set(first, (totals.get(first) ?? 0) + e.requests);
		else unassigned += e.requests;
	}
	// In the order mete/quota lists the providers; a provider with no request is left out.
	const providers = states.flatMap((s) => {
		const requests = totals.get(s.id);
		return requests ? [{ providerId: s.id, requests }] : [];
	});
	return { providers, unassigned };
};
