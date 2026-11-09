import type { ChatMessage } from "@mete/contracts";
import type { RunContext } from "./run-types.js";
import { skillMessages } from "./skill-prompt.js";
import { seatContext } from "./skill-seat.js";

/**
 * The pinned block of the seat about to call the model, rebuilt from its retained authorized
 * snapshots on every request, never from current file contents (ADR-190). Reviewers, answerers,
 * judges and runs without S2 state get none.
 */
export const pinnedFor = (
	context: Pick<
		RunContext,
		"team" | "task" | "review" | "clarify" | "judge" | "skills"
	>,
): ChatMessage[] => {
	const seat = seatContext(context);
	return seat ? skillMessages(seat.snapshots, seat.catalog) : [];
};
