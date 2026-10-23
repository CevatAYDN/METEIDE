import { z } from "zod";
import type { ModelRef } from "./llm.js";
import { LOCAL_ID, TEMPLATE_ID } from "./template.js";

// A member's pinned model (ADR-077; docs/09, Tier resolution): the folder's .mete/pins.yaml maps a
// template id and a role id to "<providerId>/<modelId>".

const PIN = /^[^/]+\/.+$/;

/** The pins file: template id, then role id, then "<providerId>/<modelId>"; none when it is missing. */
export const PinsSchema = z
	.record(
		z.string().regex(TEMPLATE_ID, "expected a kebab-case template id"),
		z.record(
			z.string().regex(LOCAL_ID, "expected a lowercase role id"),
			z.string().regex(PIN, "expected <providerId>/<modelId>"),
		),
	)
	.default({});

/** The pins of every template. */
export type Pins = z.output<typeof PinsSchema>;

/** A role's pinned model, split at the first slash, so a model id may hold one. */
export const pinOf = (
	pins: Pins,
	templateId: string,
	roleId: string,
): ModelRef | undefined => {
	const pin = pins[templateId]?.[roleId];
	const at = pin?.indexOf("/") ?? -1;
	return pin && at > 0
		? { providerId: pin.slice(0, at), modelId: pin.slice(at + 1) }
		: undefined;
};
