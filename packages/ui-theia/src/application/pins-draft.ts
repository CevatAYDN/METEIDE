import { err, ok, PinsSchema, type Result } from "@mete/contracts";
import { type Document, parseDocument } from "yaml";

// The folder's pins file as the team editor edits it (ADR-077): .mete/pins.yaml as a YAML document
// edited in place, so the other pins and the comments stay. PinsSchema says what is wrong with it.

/** The pins file being edited. */
export type PinsDraft = Document;

/** Reads the pins file's text; a missing file is no pins. */
export const pinsOf = (yaml: string | undefined): Result<PinsDraft, string> => {
	const doc = parseDocument(yaml ?? "");
	const [first] = doc.errors;
	return first ? err(first.message) : ok(doc);
};

/** A member's pin, `<providerId>/<modelId>`, or none. */
export const pinOfDraft = (
	doc: PinsDraft,
	templateId: string,
	roleId: string,
): string | undefined => {
	const pin = doc.getIn([templateId, roleId]);
	return typeof pin === "string" ? pin : undefined;
};

/** The pins of a team, by member id. */
export const pinsOfTeam = (
	doc: PinsDraft,
	templateId: string,
): Readonly<Record<string, string>> => {
	const team: unknown = doc.toJS()?.[templateId];
	if (typeof team !== "object" || team === null) return {};
	return Object.fromEntries(
		Object.entries(team).filter(
			(e): e is [string, string] => typeof e[1] === "string",
		),
	);
};

/** Whether the file holds no pin at all, so it can go. */
export const isEmpty = (doc: PinsDraft): boolean => {
	const all: unknown = doc.toJS();
	return (
		all === null ||
		all === undefined ||
		(typeof all === "object" && Object.keys(all).length === 0)
	);
};

/**
 * The draft with a member's pin set, or cleared when the value is undefined; a team whose last pin goes
 * leaves the file too, so no empty entry stays behind.
 */
export const withPin = (
	doc: PinsDraft,
	templateId: string,
	roleId: string,
	value: string | undefined,
): PinsDraft => {
	const next = doc.clone();
	if (value !== undefined) {
		next.setIn([templateId, roleId], value);
		return next;
	}
	// deleteIn throws when a key on the way is missing; a missing pin is already cleared.
	if (next.hasIn([templateId, roleId])) next.deleteIn([templateId, roleId]);
	if (
		next.hasIn([templateId]) &&
		Object.keys(pinsOfTeam(next, templateId)).length === 0
	)
		next.deleteIn([templateId]);
	return next;
};

/** What PinsSchema refuses in the draft, as one `path: message` line, or nothing. */
export const pinsIssue = (doc: PinsDraft): string | undefined => {
	const r = PinsSchema.safeParse(doc.toJS() ?? undefined);
	const [first] = r.success ? [] : r.error.issues;
	return first ? `${first.path.join(".")}: ${first.message}` : undefined;
};

/** The key a tier's chain is kept under: the tier and the needs, in any order. */
export const chainKey = (tier: string, needs: readonly string[]): string =>
	[tier, ...[...needs].sort()].join("|");
