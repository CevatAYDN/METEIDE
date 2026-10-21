import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	artifactSchema,
	err,
	ok,
	parseTemplate,
	type Result,
	type TeamTemplate,
	type TemplateParseError,
} from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { parse } from "yaml";

// Team templates from docs/08: the workspace's .mete/teams/<id>.yaml wins over the built-in templates/<id>.yaml.

const TEMPLATE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Where templates live: the built-in templates/ folder and the workspace root. */
export type TemplateDirs = {
	readonly builtIn: string;
	readonly workspace: string;
};

/** Why a template could not be loaded. */
export type TemplateError =
	| TemplateParseError
	| {
			readonly code: "not_found" | "bad_input" | "io";
			readonly message: string;
	  };

const invalid = (issue: string): TemplateError => ({
	code: "invalid_template",
	issues: [issue],
});

const codeOf = (e: unknown) =>
	e instanceof Error && "code" in e ? String(e.code) : undefined;

const readText = async (
	file: string,
): Promise<Result<string | undefined, TemplateError>> => {
	try {
		return ok(await withLockRetry(() => readFile(file, "utf8")));
	} catch (e) {
		if (codeOf(e) === "ENOENT") return ok(undefined);
		return err({ code: "io", message: `${file}: ${String(e)}` });
	}
};

// A guardrail needs its artifact schema; without it every submission would fail and spend quota.
const unknownGuardrails = (t: TeamTemplate) =>
	t.tasks.flatMap((task, i) => {
		const schema = task.guardrail?.schema;
		return schema && !artifactSchema(schema)
			? [`tasks.${i}.guardrail.schema: ${schema} has no schema yet`]
			: [];
	});

const fromText = (
	id: string,
	text: string,
): Result<TeamTemplate, TemplateError> => {
	let data: unknown;
	try {
		data = parse(text);
	} catch (e) {
		return err(invalid(e instanceof Error ? e.message : String(e)));
	}
	const t = parseTemplate(data);
	if (!t.ok) return t;
	if (t.value.metadata.id !== id)
		return err(
			invalid(
				`metadata.id: ${t.value.metadata.id} does not match the file name ${id}`,
			),
		);
	const unknown = unknownGuardrails(t.value);
	return unknown.length > 0
		? err({ code: "invalid_template", issues: unknown })
		: t;
};

/** Loads one template by id, the workspace's copy first. */
export const loadTemplate = async (
	dirs: TemplateDirs,
	id: string,
): Promise<Result<TeamTemplate, TemplateError>> => {
	if (!TEMPLATE_ID.test(id))
		return err({ code: "bad_input", message: `${id} is not a template id` });
	const files = [
		join(dirs.workspace, ".mete", "teams", `${id}.yaml`),
		join(dirs.builtIn, `${id}.yaml`),
	];
	for (const file of files) {
		const text = await readText(file);
		if (!text.ok) return text;
		if (text.value !== undefined) return fromText(id, text.value);
	}
	return err({ code: "not_found", message: `no template ${id}` });
};
