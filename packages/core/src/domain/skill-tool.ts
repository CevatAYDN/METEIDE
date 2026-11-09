import {
	type ChatMessage,
	type SkillRuntimeCatalog,
	type SkillVersion,
	SkillVersionSchema,
	type ToolCall,
	type ToolSpec,
	toolSpec,
} from "@mete/contracts";
import type { RunContext } from "./run-types.js";
import { seatContext } from "./skill-seat.js";

/** The model name of `skill.load@1`; core-owned, never an external adapter (ADR-194). */
export const SKILL_LOAD_TOOL = "skill_load";

/** Native tool description; the catalog arrives in the pinned block, not here. */
const SPEC: ToolSpec = toolSpec({
	ref: "skill.load@1",
	schema: SkillVersionSchema,
	description:
		"Load one user-approved skill from the skill catalog into your context. Pass the exact version object listed for it.",
});

type Seat = Pick<
	RunContext,
	"team" | "task" | "review" | "clarify" | "judge" | "skills"
>;

/**
 * The ready catalog of the seat that may load skills, or undefined. Only the skill-owning seat
 * of an auto-mode S2 run with a ready catalog qualifies (ADR-194).
 */
export const loadableCatalog = (
	c: Seat,
): Extract<SkillRuntimeCatalog, { status: "ready" }> | undefined => {
	if (c.skills?.policy.mode !== "auto") return undefined;
	const catalog = seatContext(c)?.catalog;
	return catalog?.status === "ready" && catalog.entries.length
		? catalog
		: undefined;
};

/** The tool spec to offer the seat, if any. */
export const skillLoadSpecs = (c: Seat): ToolSpec[] =>
	loadableCatalog(c) ? [SPEC] : [];

const same = (a: SkillVersion, b: SkillVersion) =>
	a.sourceId === b.sourceId &&
	a.sha256 === b.sha256 &&
	a.revision === b.revision;

/** The exact catalog version a call asks for; anything else never reaches security. */
export const requestedVersion = (
	c: Seat,
	call: ToolCall,
): SkillVersion | undefined => {
	if (call.name !== SKILL_LOAD_TOOL) return undefined;
	const parsed = SkillVersionSchema.safeParse(call.args);
	const catalog = loadableCatalog(c);
	if (!parsed.success || !catalog) return undefined;
	return catalog.entries.find(({ version }) => same(version, parsed.data))
		?.version;
};

/** The tool message answering a skill_load call. */
export const skillLoadResult = (
	call: ToolCall,
	content: string,
): Extract<ChatMessage, { role: "tool" }> => ({
	role: "tool",
	toolCallId: call.id,
	content,
});
