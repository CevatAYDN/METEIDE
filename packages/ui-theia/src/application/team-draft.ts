import { err, ok, type Result, TeamTemplateSchema } from "@mete/contracts";
import { type Document, parseDocument } from "yaml";
import { z } from "zod";

// The team editor's draft (docs/13, Settings, Templates; ADR-075): the template's YAML document,
// edited in place so the file keeps its comments, read leniently for the screen while it is half
// done, and checked by TeamTemplateSchema alone before Save. Every edit returns a new document.

/** A template being edited. */
export type Draft = Document;

const text = z.string().catch("");
const optional = z.string().optional().catch(undefined);
const list = z.array(z.string()).catch([]);

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
const TaskSchema = z.object({
	id: text,
	role: text,
	title: text,
	expected_output: optional,
	context: list,
	approval: optional,
	spawns: z.boolean().catch(false),
});
const TeamSchema = z.object({
	metadata: z
		.object({ id: text, name: text, description: optional })
		.catch({ id: "", name: "", description: undefined }),
	roles: z.array(MemberSchema).catch([]),
	tasks: z.array(TaskSchema).catch([]),
});

/** A team as the screen shows it. */
export type TeamView = z.output<typeof TeamSchema>;
/** One member (role) as the screen shows it. */
export type MemberView = TeamView["roles"][number];

/** Reads a template's text, or the YAML error that stops it. */
export const draftOf = (yaml: string): Result<Draft, string> => {
	const doc = parseDocument(yaml);
	const [first] = doc.errors;
	return first ? err(first.message) : ok(doc);
};

/** The team in a draft, with empty values where the draft has none. */
export const teamOf = (doc: Draft): TeamView => {
	const r = TeamSchema.safeParse(doc.toJS());
	return r.success
		? r.data
		: { metadata: { id: "", name: "" }, roles: [], tasks: [] };
};

/** What TeamTemplateSchema finds wrong with the draft, one `path: message` line per issue. */
export const issuesOf = (doc: Draft): string[] => {
	const r = TeamTemplateSchema.safeParse(doc.toJS());
	return r.success
		? []
		: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

type Path = readonly (string | number)[];

/** The draft with the value at `path` set, or removed when the value is undefined. */
export const edited = (doc: Draft, path: Path, value: unknown): Draft => {
	const next = doc.clone();
	if (value === undefined) next.deleteIn(path);
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

const removed = (doc: Draft, path: Path): Draft => {
	const next = doc.clone();
	next.deleteIn(path);
	return next;
};

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

/** The draft without the member at `index`; tasks that still name it show up in issuesOf. */
export const removeRole = (doc: Draft, index: number) =>
	removed(doc, ["roles", index]);

/** The draft with a new task for a member, with a free id and an empty title for the user to write. */
export const addTask = (doc: Draft, roleId: string): Draft => {
	const ids = teamOf(doc).tasks.map((t) => t.id);
	return added(doc, ["tasks"], {
		id: freshId(`${roleId}_task`, ids),
		role: roleId,
		title: "",
	});
};

/** The draft without the task at `index`. */
export const removeTask = (doc: Draft, index: number) =>
	removed(doc, ["tasks", index]);

/** The draft under a new template id and name, for "Save as new team". */
export const copyAs = (doc: Draft, id: string, name: string) =>
	edited(edited(doc, ["metadata", "id"], id), ["metadata", "name"], name);

/** The members no task of the team names: they act only if a spawns task's list gives them one. */
export const idleMembers = (team: TeamView): string[] =>
	team.roles
		.map((r) => r.id)
		.filter((id) => !team.tasks.some((t) => t.role === id));

/** The capability ids the team's members use, once each and sorted, as suggestions. */
export const capabilityHints = (team: TeamView): string[] =>
	[...new Set(team.roles.flatMap((r) => r.capabilities))].sort();
