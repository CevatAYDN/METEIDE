import {
	artifactSchema,
	err,
	ok,
	type Result,
	TeamTemplateSchema,
	TOOL_CATALOG,
} from "@mete/contracts";
import { Document, isNode, parseDocument } from "yaml";
import { z } from "zod";

// The team editor's draft (docs/13, Settings, Templates; ADR-075): the template's YAML document,
// edited in place so the file keeps its comments, read leniently for the screen while it is half
// done, and checked by TeamTemplateSchema alone before Save. Every edit returns a new document.

/** A template being edited. */
export type Draft = Document;

const text = z.string().catch("");
const optional = z.string().optional().catch(undefined);
const list = z.array(z.string()).catch([]);
const number = z.number().optional().catch(undefined);

// A lenient reading for the screen: a half-edited team still shows; the schema says what is wrong.
const MemberSchema = z.object({
	id: text,
	name: text,
	goal: text,
	backstory: optional,
	tier: text,
	needs: list,
	capabilities: list,
	prefer_different_family_than: list,
	watches: list,
});
// The fields a task shares with spawn_defaults that the screen edits; a gate stays as the file has it.
const WorkSchema = z.object({
	expected_output: optional,
	approval: optional,
	before_start: z.object({ clarify_with: text }).optional().catch(undefined),
	verify: z.array(z.record(z.string(), z.unknown())).catch([]),
	guardrail: z
		.object({ schema: text, max_retries: number })
		.optional()
		.catch(undefined),
	review: z
		.object({ pair_with: text, max_turns: number })
		.optional()
		.catch(undefined),
	memory: z.object({ write_lessons: z.boolean() }).optional().catch(undefined),
	attempts: z
		.object({ n: z.number(), distinct_families: z.boolean(), judge_tier: text })
		.optional()
		.catch(undefined),
});
const TaskSchema = WorkSchema.extend({
	id: text,
	role: text,
	title: text,
	context: list,
	spawns: z.boolean().catch(false),
});
const TeamSchema = z.object({
	metadata: z
		.object({ id: text, name: text, description: optional })
		.catch({ id: "", name: "", description: undefined }),
	roles: z.array(MemberSchema).catch([]),
	tasks: z.array(TaskSchema).catch([]),
	spawn_defaults: z.record(z.string(), WorkSchema).catch({}),
	policies: z
		.object({ revision_limit: number, human_checkpoints: list })
		.catch({ revision_limit: undefined, human_checkpoints: [] }),
	budget: z
		.object({ cloud_requests: number, max_hours: number })
		.catch({ cloud_requests: undefined, max_hours: undefined }),
});

/** A team as the screen shows it. */
export type TeamView = z.output<typeof TeamSchema>;
/** One member (role) as the screen shows it. */
export type MemberView = TeamView["roles"][number];
/** What a task or a member's spawn defaults ask of the work. */
export type WorkView = z.output<typeof WorkSchema>;
/** A verify gate as the file has it. */
export type Gate = WorkView["verify"][number];

const EMPTY: TeamView = TeamSchema.parse({});

/** Reads a template's text, or the YAML error that stops it. */
export const draftOf = (yaml: string): Result<Draft, string> => {
	const doc = parseDocument(yaml);
	const [first] = doc.errors;
	return first ? err(first.message) : ok(doc);
};

/** A template id: lower case words joined by dashes (the schema's rule, which contracts does not export). */
export const TEMPLATE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** An id suggested from a team's name, or none when the name has no letter or digit (ADR-093). */
export const idOfName = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

/**
 * A blank team (ADR-093): one member with the coder tier and an empty name and goal, and one task of
 * that member with an empty title, for the user to write; the schema refuses it until they are.
 */
export const blankDraft = (id: string, name: string): Draft =>
	new Document({
		apiVersion: "mete/v1",
		kind: "TeamTemplate",
		metadata: { id, name, version: "0.1.0" },
		pattern: "single",
		roles: [
			{ id: "lead", name: "", goal: "", tier: "coder", capabilities: [] },
		],
		tasks: [{ id: "lead_task", role: "lead", title: "" }],
	});

/** The team in a draft, with empty values where the draft has none. */
export const teamOf = (doc: Draft): TeamView => {
	const r = TeamSchema.safeParse(doc.toJS());
	return r.success ? r.data : EMPTY;
};

// A guardrail needs its artifact schema: core refuses such a team when it loads it (template-store),
// and a spawn default's guardrail would fail every spawned task the same way.
const unknownGuardrails = (team: TeamView): string[] => {
	const at = (path: string, w: WorkView) => {
		const schema = w.guardrail?.schema;
		return schema && !artifactSchema(schema)
			? [`${path}.guardrail.schema: ${schema} has no schema yet`]
			: [];
	};
	return [
		...team.tasks.flatMap((t, i) => at(`tasks.${i}`, t)),
		...Object.entries(team.spawn_defaults).flatMap(([role, w]) =>
			at(`spawn_defaults.${role}`, w),
		),
	];
};

/** What TeamTemplateSchema finds wrong with the draft, one `path: message` line per issue. */
export const issuesOf = (doc: Draft): string[] => {
	const r = TeamTemplateSchema.safeParse(doc.toJS());
	return r.success
		? unknownGuardrails(teamOf(doc))
		: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

type Path = readonly (string | number)[];

/** The draft with the value at `path` set, or removed when the value is undefined. */
export const edited = (doc: Draft, path: Path, value: unknown): Draft => {
	const next = doc.clone();
	// deleteIn throws when a key on the way is missing; a missing key is already removed.
	if (value === undefined) {
		if (next.hasIn(path)) next.deleteIn(path);
	}
	// A scalar keeps the node and its comment; a list or map becomes a new node.
	else
		next.setIn(
			path,
			typeof value === "object" && value !== null
				? next.createNode(value)
				: value,
		);
	return next;
};

const added = (doc: Draft, path: Path, value: object): Draft => {
	const next = doc.clone();
	next.addIn(path, next.createNode(value));
	return next;
};

const removed = (doc: Draft, path: Path) => edited(doc, path, undefined);

const freshId = (base: string, taken: readonly string[]) => {
	let id = base;
	for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
	return id;
};

/**
 * The draft with a new member: a free id, an empty name and goal for the user to write, and the coder
 * tier, the one core seats an agent on when a role names none (team-run.ts).
 */
export const addRole = (doc: Draft): Draft => {
	const ids = teamOf(doc).roles.map((r) => r.id);
	return added(doc, ["roles"], {
		id: freshId("member", ids),
		name: "",
		goal: "",
		tier: "coder",
		capabilities: [],
	});
};

/**
 * The draft without the member at `index`, its spawn defaults and the other members' preference to
 * differ from it, which the screen shows no control for; tasks that still name it show up in issuesOf.
 */
export const removeRole = (doc: Draft, index: number): Draft => {
	const team = teamOf(doc);
	const id = team.roles[index]?.id ?? "";
	let next = removed(removed(doc, ["roles", index]), ["spawn_defaults", id]);
	team.roles.forEach((r, i) => {
		const kept = r.prefer_different_family_than.filter((x) => x !== id);
		if (i !== index && kept.length < r.prefer_different_family_than.length)
			next = edited(
				next,
				["roles", i < index ? i : i - 1, "prefer_different_family_than"],
				kept,
			);
	});
	return next;
};

// Where a task or a spawn default names a role (docs/08, Team template schema).
const ROLE_REFS = [
	["role"],
	["approval"],
	["before_start", "clarify_with"],
	["review", "pair_with"],
] as const;

// The draft with every reference to the role `from` pointing at `to`, but its id and its spawn defaults' key.
const pointed = (doc: Draft, from: string, to: string): Draft => {
	const team = teamOf(doc);
	const bases: Path[] = [
		...team.tasks.map((_, i) => ["tasks", i]),
		...Object.keys(team.spawn_defaults).map((r) => ["spawn_defaults", r]),
	];
	let next = doc;
	for (const base of bases)
		for (const ref of ROLE_REFS)
			if (next.getIn([...base, ...ref]) === from)
				next = edited(next, [...base, ...ref], to);
	team.roles.forEach((r, i) => {
		if (r.prefer_different_family_than.includes(from))
			next = edited(
				next,
				["roles", i, "prefer_different_family_than"],
				r.prefer_different_family_than.map((x) => (x === from ? to : x)),
			);
	});
	return next;
};

/**
 * The draft with the member at `index` under a new id, and its tasks, spawn defaults, approvals and the
 * others' family preferences following it; refused when another member has the id.
 */
export const renameRole = (
	doc: Draft,
	index: number,
	id: string,
): Result<Draft, { readonly taken: string }> => {
	const roles = teamOf(doc).roles;
	const from = roles[index]?.id;
	if (from === undefined) return ok(doc);
	if (roles.some((r) => r.id === id)) return err({ taken: id });
	let next = pointed(edited(doc, ["roles", index, "id"], id), from, id);
	const defaults = next.getIn(["spawn_defaults", from], true);
	if (isNode(defaults))
		next = edited(
			removed(next, ["spawn_defaults", from]),
			["spawn_defaults", id],
			defaults.clone(),
		);
	return ok(next);
};

/** The draft with a new task for a member, with a free id and an empty title for the user to write. */
export const addTask = (doc: Draft, roleId: string): Draft => {
	const ids = teamOf(doc).tasks.map((t) => t.id);
	return added(doc, ["tasks"], {
		id: freshId(`${roleId}_task`, ids),
		role: roleId,
		title: "",
	});
};

/** The draft without the task at `index` and its human checkpoint, which only its row shows. */
export const removeTask = (doc: Draft, index: number) => {
	const id = teamOf(doc).tasks[index]?.id ?? "";
	return withCheckpoint(removed(doc, ["tasks", index]), id, false);
};

/** The ids with `id` in or out, keeping the others' order. */
export const toggled = (ids: readonly string[], id: string, on: boolean) => {
	const kept = ids.filter((x) => x !== id);
	return on ? [...kept, id] : kept;
};

/** The draft with the human approving the task after its approver, or no longer. */
export const withCheckpoint = (doc: Draft, taskId: string, on: boolean) => {
	const next = toggled(teamOf(doc).policies.human_checkpoints, taskId, on);
	return edited(
		doc,
		["policies", "human_checkpoints"],
		next.length > 0 ? next : undefined,
	);
};

/** The shell commands among a task's verify gates. */
export const runsOf = (verify: readonly Gate[]): string[] =>
	verify.flatMap((g) => (typeof g.run === "string" ? [g.run] : []));

/**
 * The verify gates with these commands: the capability gates come first, as the file has them,
 * since the screen shows no control for them; undefined when no gate is left.
 */
export const withRuns = (verify: readonly Gate[], runs: readonly string[]) => {
	const next = [
		...verify.filter((g) => typeof g.run !== "string"),
		...runs.map((run) => ({ run })),
	];
	return next.length > 0 ? next : undefined;
};

/** The draft under a new template id and name, for "Save as new team". */
export const copyAs = (doc: Draft, id: string, name: string) =>
	edited(edited(doc, ["metadata", "id"], id), ["metadata", "name"], name);

/** The members no task of the team names: they act only if a spawns task's list gives them one. */
export const idleMembers = (team: TeamView): string[] =>
	team.roles
		.map((r) => r.id)
		.filter((id) => !team.tasks.some((t) => t.role === id));

/** Every model tool's capability id and the ids the team's members use, once each and sorted, as suggestions (ADR-150). */
export const capabilityHints = (team: TeamView): string[] =>
	[
		...new Set([
			...TOOL_CATALOG.map((t) => t.ref),
			...team.roles.flatMap((r) => r.capabilities),
		]),
	].sort();

/** The artifact types the team's tasks produce that have a schema, as guardrail suggestions. */
export const guardrailHints = (team: TeamView): string[] => {
	const outputs = [...team.tasks, ...Object.values(team.spawn_defaults)].map(
		(w) => w.expected_output?.replace(/^artifact:/, "") ?? "",
	);
	return [...new Set(outputs)].filter((t) => artifactSchema(t)).sort();
};

/** The selected member's index after the member at `removed` left, with `count` members left (ADR-093). */
export const selectedAfterRemove = (
	selected: number,
	removed: number,
	count: number,
): number =>
	Math.max(0, Math.min(count - 1, selected - (removed <= selected ? 1 : 0)));

/** The team's own name, for the run strip (ADR-094); none when the text does not parse or names none. */
export const teamName = (yaml: string): string | undefined => {
	const doc = draftOf(yaml);
	return doc.ok ? teamOf(doc.value).metadata.name || undefined : undefined;
};

/** Each member's name by its id, for the Team view (ADR-089); a text that does not parse names none. */
export const roleNames = (yaml: string): Readonly<Record<string, string>> => {
	const doc = draftOf(yaml);
	if (!doc.ok) return {};
	return Object.fromEntries(
		teamOf(doc.value)
			.roles.filter((r) => r.id && r.name)
			.map((r) => [r.id, r.name]),
	);
};
