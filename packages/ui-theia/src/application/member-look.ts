import type { Tier } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { MemberState } from "../domain/roster.js";
import { elapsedText } from "./time-text.js";
import type { Tone } from "./tone.js";

// How a member reads everywhere it shows (ADR-089, ADR-127): its tier as a plain label with an icon,
// and its state as an icon, a word and a tone, never a colour alone. Icons are Theia's codicons.

export const TIER_ICONS: Readonly<Record<Tier, string>> = {
	reasoning: "lightbulb",
	coder: "code",
	fast: "zap",
	"long-context": "book",
	vision: "eye",
};

/** A tier's plain label (ADR-089); the team file keeps the tier id. */
export const tierLabel = (tier: Tier): string =>
	({
		reasoning: nls.localize("mete/roster/reasoning", "Thinker"),
		coder: nls.localize("mete/roster/coder", "Coder"),
		fast: nls.localize("mete/roster/fast", "Fast"),
		"long-context": nls.localize("mete/roster/longContext", "Long reads"),
		vision: nls.localize("mete/roster/vision", "Sees images"),
	})[tier];

const until = (at: string) =>
	new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export type Look = {
	readonly icon: string;
	readonly text: string;
	readonly tone: Tone;
	readonly spin?: boolean;
};

// The words of a state; the two with a value take it from the state.
const stateText = (s: MemberState): string => {
	if (s.kind === "quota")
		return nls.localize(
			"mete/roster/quota",
			"Waiting for quota until {0}",
			until(s.resetsAt),
		);
	// A model call in flight counts its seconds (ADR-125).
	if (s.kind === "thinking" && s.since)
		return nls.localize(
			"mete/roster/thinkingFor",
			"Thinking · {0}",
			elapsedText(s.since),
		);
	if (s.kind === "working")
		return nls.localize(
			"mete/roster/working",
			"Working with {0}",
			s.tool.replace(/@\d+$/, ""),
		);
	return {
		waits_for_you: nls.localize("mete/roster/waitsForYou", "Waiting for you"),
		thinking: nls.localize("mete/roster/thinking", "Thinking"),
		blocked: nls.localize("mete/roster/blocked", "Blocked"),
		done: nls.localize("mete/roster/done", "Done"),
		idle: nls.localize("mete/roster/idle", "Idle"),
	}[s.kind];
};

const LOOKS: Readonly<Record<MemberState["kind"], Omit<Look, "text">>> = {
	waits_for_you: { icon: "bell", tone: "warn" },
	quota: { icon: "watch", tone: "warn" },
	working: { icon: "tools", tone: "accent" },
	thinking: { icon: "loading", tone: "accent", spin: true },
	blocked: { icon: "circle-slash", tone: "bad" },
	done: { icon: "pass", tone: "good" },
	idle: { icon: "circle-outline", tone: "muted" },
};

/** A member's state as an icon, a word and a tone. */
export const stateLook = (s: MemberState): Look => ({
	...LOOKS[s.kind],
	text: stateText(s),
});
