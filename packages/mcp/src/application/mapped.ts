import {
	type CapabilityRef,
	err,
	MAPPABLE_OUTPUTS,
	type McpMapping,
	type McpMappingEntry,
	ok,
	type PolicyCheckAdapter,
	type Result,
	TOOL_CATALOG,
	type ToolAdapter,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import { render, resultScope, type Scope } from "../domain/render.js";
import { permit } from "./permit.js";
import type { Sessions } from "./sessions.js";

// A level 2 MCP mapping as an adapter of the capability it implements (docs/10, Integration
// levels): render the arguments, call the tool, render the output and check it with the
// capability's output schema. Every failure names the mapping and the capability.

export type MappedDeps = {
	readonly workspaceDir: string;
	readonly sessions: Sessions;
	readonly policy: () => PolicyCheckAdapter | undefined;
};

type Target = {
	readonly mapping: McpMapping;
	readonly ref: CapabilityRef;
	readonly entry: McpMappingEntry;
};

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

const failed =
	(t: Target) =>
	(message: string): ToolError => ({
		code: "io",
		message: `mapping ${t.mapping.metadata.id} for ${t.ref}: ${message}`,
	});

// The capability's own input schema fills defaults (web.search@1 maxResults) before rendering.
const inputOf = (
	ref: CapabilityRef,
	raw: unknown,
): Result<unknown, ToolError> => {
	const schema = TOOL_CATALOG.find((t) => t.ref === ref)?.schema;
	if (!schema) return ok(raw);
	const r = schema.safeParse(raw);
	return r.success
		? ok(r.data)
		: err({ code: "bad_input", message: r.error.message });
};

const callTool = async (
	deps: MappedDeps,
	t: Target,
	args: unknown,
	ctx: ToolContext,
): Promise<Result<Scope, string>> => {
	const { signal } = ctx;
	const s = await deps.sessions.get(t.mapping.server, signal);
	if (!s.ok) return err(s.error.message);
	try {
		const options = deps.sessions.callOptions(
			t.mapping.server,
			t.entry.tool,
			signal,
		);
		const r = await deps.sessions.calls.during(t.mapping.server, ctx, () =>
			s.value.client.callTool(
				{ name: t.entry.tool, arguments: args as Record<string, unknown> },
				undefined,
				options,
			),
		);
		const blocks = Array.isArray(r.content) ? r.content : [];
		const texts = blocks.flatMap((b) => (b.type === "text" ? [b.text] : []));
		if (r.isError === true)
			return err(`tool ${t.entry.tool} failed: ${texts.join(" ")}`);
		return ok(resultScope(r.structuredContent, texts));
	} catch (e) {
		return err(`tool ${t.entry.tool}: ${why(e)}`);
	}
};

const outputOf = (t: Target, scope: Scope): Result<unknown, string> => {
	const rendered = render(t.entry.output, scope);
	if (!rendered.ok) return rendered;
	const schema = MAPPABLE_OUTPUTS[t.ref];
	const r = schema?.safeParse(rendered.value);
	if (!r) return err("the capability has no output schema to check against");
	if (r.success) return ok(r.data);
	const issue = r.error.issues[0];
	return err(
		`output ${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}`,
	);
};

const run = async (
	deps: MappedDeps,
	t: Target,
	raw: unknown,
	ctx: ToolContext,
): Promise<Result<unknown, ToolError>> => {
	const input = inputOf(t.ref, raw);
	if (!input.ok) return input;
	const base = { input: input.value, workspace: { path: deps.workspaceDir } };
	const args = render(t.entry.args, base);
	if (!args.ok) return err(failed(t)(`args ${args.error}`));
	const command = `${t.mapping.server}/${t.entry.tool}`;
	const check = {
		adapterId: t.mapping.metadata.id,
		action: t.entry.action,
		capability: t.ref,
		command,
		args: args.value,
	};
	const allowed = permit(deps.policy(), check, ctx);
	if (!allowed.ok) return allowed;
	const result = await callTool(deps, t, args.value, ctx);
	if (!result.ok) return err(failed(t)(result.error));
	const out = outputOf(t, { ...base, result: result.value });
	return out.ok ? out : err(failed(t)(out.error));
};

/** The adapter for one `implements` entry of a mapping. */
export const mappedAdapter = (
	deps: MappedDeps,
	t: Target,
): ToolAdapter<unknown, unknown> => ({
	run: (input, ctx) => run(deps, t, input, ctx),
});
