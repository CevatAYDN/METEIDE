import { describe, expect, it } from "vitest";
import {
	chainKey,
	isEmpty,
	pinOfDraft,
	pinsIssue,
	pinsOf,
	withPin,
} from "../src/application/pins-draft.js";

// The folder's pins file as the team editor edits it (ADR-077): a YAML document edited in place, so
// the other pins and the comments stay.

const draft = (text?: string) => {
	const d = pinsOf(text);
	if (!d.ok) throw new Error(d.error);
	return d.value;
};

describe("pinsOf", () => {
	it("reads a missing file as no pins, and refuses text that is not YAML", () => {
		expect(isEmpty(draft(undefined))).toBe(true);
		expect(pinsOf("a: [").ok).toBe(false);
	});
});

describe("withPin", () => {
	it("pins a member of a team in a new file, and reads it back", () => {
		const doc = withPin(draft(), "game-studio", "developer", "groq/m");
		expect(pinOfDraft(doc, "game-studio", "developer")).toBe("groq/m");
		expect(pinsIssue(doc)).toBeUndefined();
	});

	it("keeps the other pins and the comments, and never changes the draft it was given", () => {
		const text = "# my pins\nweb-dev:\n  qa: groq/a # fast one\n";
		const before = draft(text);
		const doc = withPin(before, "web-dev", "lead", "nvidia/b");
		expect(doc.toString()).toContain("# my pins");
		expect(doc.toString()).toContain("# fast one");
		expect(pinOfDraft(doc, "web-dev", "qa")).toBe("groq/a");
		expect(before.toString()).toBe(text);
	});

	it("clears a pin, and the team's entry when it was the last one", () => {
		const doc = draft(
			"web-dev:\n  qa: groq/a\n  lead: groq/b\nresearch:\n  lead: groq/c\n",
		);
		const one = withPin(doc, "web-dev", "qa", undefined);
		expect(pinOfDraft(one, "web-dev", "qa")).toBeUndefined();
		expect(pinOfDraft(one, "web-dev", "lead")).toBe("groq/b");
		const none = withPin(one, "web-dev", "lead", undefined);
		expect(none.hasIn(["web-dev"])).toBe(false);
		expect(isEmpty(withPin(none, "research", "lead", undefined))).toBe(true);
		// Clearing what is not there changes nothing.
		expect(withPin(none, "seo-audit", "lead", undefined).toString()).toBe(
			none.toString(),
		);
	});

	it("names what PinsSchema refuses, such as a pin without a model", () => {
		expect(pinsIssue(withPin(draft(), "web-dev", "qa", "groq"))).toContain(
			"web-dev.qa",
		);
	});
});

describe("chainKey", () => {
	it("is the same for the same tier and needs in any order", () => {
		expect(chainKey("coder", ["vision", "tool_calling"])).toBe(
			chainKey("coder", ["tool_calling", "vision"]),
		);
		expect(chainKey("coder", [])).not.toBe(chainKey("fast", []));
	});
});
