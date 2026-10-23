import { z } from "zod";
import { LocalIdSchema } from "./template.js";

// The game-studio artifact types of docs/08 (ADR-057). The rules that need the template, such as a
// task-list entry naming one of its roles, are core's to check when it spawns the tasks.

const text = z.string().min(1);
const sentences = z.array(text).min(1).readonly();

/** gdd@1: the game design document the designer writes and the lead and the human approve. */
export const GddSchema = z.strictObject({
	title: text,
	pitch: text,
	mechanics: sentences,
	scope: text,
	acceptance: sentences,
});

const TaskListEntrySchema = z.strictObject({
	id: LocalIdSchema,
	role: LocalIdSchema.refine(
		(r) => r !== "human",
		"a task's role is never human",
	),
	title: text,
	acceptance: sentences,
	dependsOn: z.array(LocalIdSchema).readonly().optional(),
});

/** task-list@1: the tasks a `spawns` task creates; an entry waits only for earlier entries. */
export const TaskListSchema = z
	.strictObject({ tasks: z.array(TaskListEntrySchema).min(1).readonly() })
	.superRefine((list, ctx) => {
		list.tasks.forEach((t, i) => {
			const before = list.tasks.slice(0, i).map((e) => e.id);
			if (before.includes(t.id))
				ctx.addIssue({
					code: "custom",
					path: ["tasks", i, "id"],
					message: `task ${t.id} is listed twice`,
				});
			for (const dep of t.dependsOn ?? [])
				if (!before.includes(dep))
					ctx.addIssue({
						code: "custom",
						path: ["tasks", i, "dependsOn"],
						message: `${dep} is not an earlier task of the list`,
					});
		});
	});

/** A validated task list. */
export type TaskList = z.output<typeof TaskListSchema>;

/** asset-spec@1: the assets a design needs, each with the file it goes to. */
export const AssetSpecSchema = z.strictObject({
	assets: z
		.array(z.strictObject({ name: text, description: text, path: text }))
		.min(1)
		.readonly(),
});

/** test-report@1: what was checked, and what could not be. */
export const TestReportSchema = z
	.strictObject({
		passed: z.boolean(),
		checks: z
			.array(z.strictObject({ name: text, passed: z.boolean(), details: text }))
			.min(1)
			.readonly(),
		gaps: z.array(text).readonly(),
	})
	.refine((r) => !r.passed || r.checks.every((c) => c.passed), {
		path: ["passed"],
		message: "passed is true only when every check passed",
	});

/** code-change@1: what a change did and the files it wrote. */
export const CodeChangeSchema = z.strictObject({
	summary: text,
	files: z.array(text).min(1).readonly(),
});
