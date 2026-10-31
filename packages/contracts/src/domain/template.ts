import { z } from "zod";
import { TEMPLATE_DEFAULTS as D } from "../defaults.js";
import {
	ArtifactTypeRefSchema,
	type CapabilityRef,
	CapabilityRefSchema,
	SemverSchema,
} from "./ids.js";
import { NeedSchema, TierSchema } from "./llm.js";
import { err, ok, type Result } from "./result.js";

// Team template file from docs/08 (Team template schema, Task fields); keys as written in YAML.

const text = z.string().min(1);
/** A role or task id, such as write_gdd. */
export const LOCAL_ID = /^[a-z][a-z0-9_]*$/;
/** A template id, such as game-studio. */
export const TEMPLATE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FS_WILDCARD = /^fs\.\*@[1-9]\d*$/;
const ARTIFACT = "artifact:";

/** A role or task id: lowercase with underscores (docs/08). */
export const LocalIdSchema = z
	.string()
	.regex(LOCAL_ID, "expected a lowercase id like write_gdd");
const localId = LocalIdSchema;
const ids = z.array(localId).readonly();

const RoleCapabilitySchema = z.custom<CapabilityRef>(
	(v) =>
		typeof v === "string" &&
		(FS_WILDCARD.test(v) || CapabilityRefSchema.safeParse(v).success),
	"expected a capability id; only the fs domain takes a wildcard (fs.*@1)",
);

const OutputSchema = z.custom<`artifact:${string}`>(
	(v) =>
		typeof v === "string" &&
		v.startsWith(ARTIFACT) &&
		ArtifactTypeRefSchema.safeParse(v.slice(ARTIFACT.length)).success,
	"expected an artifact ref like artifact:gdd@1",
);

const RoleSchema = z.strictObject({
	id: localId,
	name: text,
	goal: text,
	backstory: text.optional(),
	tier: TierSchema,
	needs: z.array(NeedSchema).readonly().optional(),
	prefer_different_family_than: ids.optional(),
	capabilities: z.array(RoleCapabilitySchema).readonly(),
	watches: z.array(ArtifactTypeRefSchema).readonly().optional(),
});

const VerifySchema = z.union([
	z.strictObject({
		capability: CapabilityRefSchema,
		args: z.record(z.string(), z.unknown()).optional(),
		expect: z.unknown().optional(),
	}),
	z.strictObject({ run: text }),
]);

const count = z.number().int();

// The fields a task shares with spawn_defaults (docs/08, Task fields).
const taskFields = {
	expected_output: OutputSchema.optional(),
	context: ids.optional(),
	before_start: z.strictObject({ clarify_with: localId }).optional(),
	verify: z.array(VerifySchema).readonly().optional(),
	guardrail: z
		.strictObject({
			schema: ArtifactTypeRefSchema,
			max_retries: count.nonnegative().default(D.guardrailMaxRetries),
		})
		.optional(),
	review: z
		.strictObject({
			pair_with: localId,
			max_turns: count.positive().default(D.reviewMaxTurns),
		})
		.optional(),
	approval: localId.optional(),
	memory: z.strictObject({ write_lessons: z.boolean() }).optional(),
	attempts: z
		.strictObject({
			n: count.positive(),
			distinct_families: z.boolean(),
			judge_tier: TierSchema,
		})
		.optional(),
	spawns: z.boolean().optional(),
};

const TaskFieldsSchema = z.strictObject(taskFields);
const TaskSchema = z.strictObject({
	id: localId,
	role: localId,
	title: text,
	...taskFields,
});

const BaseSchema = z.strictObject({
	apiVersion: z.literal("mete/v1"),
	kind: z.literal("TeamTemplate"),
	metadata: z.strictObject({
		id: z.string().regex(TEMPLATE_ID, "expected a kebab-case template id"),
		name: text,
		version: SemverSchema,
		description: text.optional(),
	}),
	engine: z.enum(["native", "crewai", "metagpt", "chatdev"]).default(D.engine),
	pattern: z.enum([
		"single",
		"pipeline",
		"hierarchical",
		"parallel_then_synthesize",
	]),
	roles: z.array(RoleSchema).min(1).readonly(),
	tasks: z.array(TaskSchema).min(1).readonly(),
	spawn_defaults: z.record(z.string(), TaskFieldsSchema).optional(),
	policies: z
		.strictObject({
			revision_limit: count.nonnegative().default(D.revisionLimit),
			human_checkpoints: ids.optional(),
			retrospective: z.boolean().default(D.retrospective),
		})
		.prefault({}),
	budget: z
		.strictObject({
			cloud_requests: count.positive().default(D.cloudRequests),
			max_hours: z.number().positive().default(D.maxHours),
		})
		.prefault({}),
});

type Base = z.output<typeof BaseSchema>;
type Path = (string | number)[];
type Refs = {
	readonly ctx: z.RefinementCtx;
	readonly roles: ReadonlySet<string>;
	readonly tasks: ReadonlySet<string>;
};

const issue = (r: Refs, path: Path, message: string) =>
	r.ctx.addIssue({ code: "custom", path, message });

// An approver is a role or the human.
type Kind = "role" | "task" | "approver";

const known = (
	r: Refs,
	path: Path,
	list: readonly string[] | undefined,
	kind: Kind,
) => {
	const allowed = kind === "task" ? r.tasks : r.roles;
	for (const id of list ?? [])
		if (!allowed.has(id) && !(kind === "approver" && id === "human"))
			issue(r, path, `unknown ${kind === "task" ? "task" : "role"} ${id}`);
};

// Every role or task a task names must exist; approval and clarify_with may also name the human.
const checkTask = (
	r: Refs,
	path: Path,
	f: z.output<typeof TaskFieldsSchema> & { role?: string },
) => {
	if (f.role !== undefined) known(r, [...path, "role"], [f.role], "role");
	known(r, [...path, "context"], f.context, "task");
	if (f.approval) known(r, [...path, "approval"], [f.approval], "approver");
	const clarify = f.before_start?.clarify_with;
	if (clarify) known(r, [...path, "before_start"], [clarify], "approver");
	if (f.review) known(r, [...path, "review"], [f.review.pair_with], "role");
	// The pair reviews before the approver; one role in both would count as one approval (ADR-136).
	if (f.review && f.review.pair_with === f.approval)
		issue(
			r,
			[...path, "review"],
			`the pair reviewer ${f.approval} is also the approver`,
		);
};

const twice = (r: Refs, kind: string, list: readonly string[]) => {
	for (const id of new Set(list.filter((x, i) => list.indexOf(x) !== i)))
		issue(r, [`${kind}s`], `${kind} ${id} is defined twice`);
};

type Deps = ReadonlyMap<string, readonly string[]>;

// The first circle among the tasks' `context` found from `id`, as the ids in order with the first one
// repeated at the end; `path` is how the walk got here and `done` the tasks known to lead to no circle.
const circleFrom = (
	deps: Deps,
	id: string,
	path: readonly string[],
	done: Set<string>,
): string[] | undefined => {
	const at = path.indexOf(id);
	if (at >= 0) return [...path.slice(at), id];
	if (done.has(id)) return undefined;
	for (const d of deps.get(id) ?? []) {
		const found = circleFrom(deps, d, [...path, id], done);
		if (found) return found;
	}
	done.add(id);
	return undefined;
};

// A task waits for the tasks of its context, so tasks that wait for each other never start.
// shortcut: only the first circle is named; the next parse finds the next one.
const checkCircle = (r: Refs, tasks: Base["tasks"]) => {
	const deps: Deps = new Map(tasks.map((x) => [x.id, x.context ?? []]));
	const done = new Set<string>();
	for (const id of deps.keys()) {
		const circle = circleFrom(deps, id, [], done);
		if (circle) {
			issue(
				r,
				["tasks"],
				`tasks wait for each other in a circle: ${circle.join(" -> ")}`,
			);
			return;
		}
	}
};

const checkRefs = (t: Base, ctx: z.RefinementCtx) => {
	const roleIds = t.roles.map((x) => x.id);
	const taskIds = t.tasks.map((x) => x.id);
	const r: Refs = { ctx, roles: new Set(roleIds), tasks: new Set(taskIds) };
	twice(r, "role", roleIds);
	twice(r, "task", taskIds);
	if (r.roles.has("human"))
		issue(r, ["roles"], "human is reserved for the user");
	// The judge's agent.created names role id judge (ADR-162): a role so named would read as it.
	if (r.roles.has("judge"))
		issue(
			r,
			["roles"],
			"judge is reserved for the judge that picks among a task's attempts",
		);
	t.roles.forEach((x, i) => {
		const path = ["roles", i, "prefer_different_family_than"];
		known(r, path, x.prefer_different_family_than, "role");
	});
	t.tasks.forEach((x, i) => {
		checkTask(r, ["tasks", i], x);
	});
	checkCircle(r, t.tasks);
	for (const [role, f] of Object.entries(t.spawn_defaults ?? {})) {
		known(r, ["spawn_defaults", role], [role], "role");
		checkTask(r, ["spawn_defaults", role], f);
	}
	const checkpoints = t.policies.human_checkpoints;
	known(r, ["policies", "human_checkpoints"], checkpoints, "task");
};

/** A team template file; unknown keys are rejected and references must resolve (docs/08). */
export const TeamTemplateSchema = BaseSchema.superRefine(checkRefs);

/** A validated team template with its defaults filled in. */
export type TeamTemplate = z.output<typeof TeamTemplateSchema>;

/** Why a template failed validation. */
export type TemplateParseError = {
	readonly code: "invalid_template";
	readonly issues: ReadonlyArray<string>;
};

/** Validates a parsed template file. */
export const parseTemplate = (
	input: unknown,
): Result<TeamTemplate, TemplateParseError> => {
	const r = TeamTemplateSchema.safeParse(input);
	if (r.success) return ok(r.data);
	return err({
		code: "invalid_template",
		issues: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
	});
};
