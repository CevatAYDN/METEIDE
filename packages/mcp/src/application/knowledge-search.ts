import {
	DaemonKnowledgeSearchResultSchema,
	err,
	KnowledgeSearchInputSchema,
	ok,
	type Result,
	type SecretsMaskAdapter,
	type ToolAdapter,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import type {
	CallToolResult,
	ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";

const WorkspaceResult = DaemonKnowledgeSearchResultSchema.refine((value) =>
	value.results.every((hit) => hit.scope === "workspace"),
);
const Refusal = z.discriminatedUnion("code", [
	z.object({
		code: z.enum([
			"bad_input",
			"not_found",
			"outside_workspace",
			"ignored",
			"exists",
			"is_directory",
			"binary",
			"io",
		]),
		message: z.string(),
	}),
	z.object({
		code: z.literal("match_count"),
		message: z.string(),
		count: z.number(),
	}),
	z.object({
		code: z.enum(["denied", "approval_required"]),
		message: z.string(),
		rule: z.string(),
	}),
]);
const Envelope = z.discriminatedUnion("ok", [
	z.strictObject({ ok: z.literal(true), value: WorkspaceResult }),
	z.strictObject({ ok: z.literal(false), error: Refusal }),
]);
const boundedEnvelope = (k: number) =>
	Envelope.refine((r) => !r.ok || r.value.results.length <= k);
const Masked = z.strictObject({
	text: z.string(),
	masked: z.number().int().nonnegative(),
});
const failed = (text: string): CallToolResult => ({
	content: [{ type: "text", text }],
	isError: true,
});
const io = () => failed("io: knowledge search failed");
const maskStrings = async (
	masker: SecretsMaskAdapter,
	value: unknown,
): Promise<Result<unknown, void>> => {
	if (typeof value === "string") {
		const masked = Masked.safeParse(await masker.mask(value));
		return masked.success ? ok(masked.data.text) : err(undefined);
	}
	if (typeof value !== "object" || value === null) return ok(value);
	const entries = await Promise.all(
		Object.entries(value).map(
			async ([k, v]) => [k, await maskStrings(masker, v)] as const,
		),
	);
	if (entries.some(([, result]) => !result.ok)) return err(undefined);
	const values = entries.map(([k, result]) => [
		k,
		result.ok ? result.value : undefined,
	]);
	return ok(
		Array.isArray(value)
			? values.map(([, v]) => v)
			: Object.fromEntries(values),
	);
};
const maskedAnswer = async (
	result: z.infer<typeof Envelope>,
	masker: SecretsMaskAdapter,
	signal: AbortSignal,
): Promise<CallToolResult> => {
	const masked = await maskStrings(
		masker,
		result.ok ? result.value : result.error.message,
	);
	if (signal.aborted || !masked.ok) return io();
	if (!result.ok) {
		const refusal = Refusal.safeParse({
			...result.error,
			message: masked.value,
		});
		return refusal.success
			? failed(`${refusal.data.code}: ${refusal.data.message}`)
			: io();
	}
	const output = WorkspaceResult.refine(
		(v) => v.results.length <= result.value.results.length,
	).safeParse(masked.value);
	return output.success
		? {
				content: [{ type: "text", text: JSON.stringify(output.data) }],
				structuredContent: output.data,
			}
		: io();
};
const runSearch = async (
	registry: CapabilityRegistry,
	lifetime: AbortSignal,
	{ query }: { query: string },
	ctx: ServerContext,
): Promise<CallToolResult> => {
	const signal = AbortSignal.any([ctx.mcpReq.signal, lifetime]);
	if (signal.aborted) return io();
	const input = KnowledgeSearchInputSchema.safeParse({
		query,
		scope: "workspace",
	});
	if (!input.success) return failed("bad_input: query must not be empty");
	try {
		const search =
			registry.resolve<
				ToolAdapter<z.infer<typeof KnowledgeSearchInputSchema>, unknown>
			>("knowledge.search@1");
		const masking = registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
		if (!search.ok || !masking.ok)
			return failed("not_supported: knowledge search or masking is not active");
		const result = boundedEnvelope(input.data.k).safeParse(
			await search.value[0].impl.run(input.data, { signal }),
		);
		if (signal.aborted || !result.success) return io();
		return await maskedAnswer(result.data, masking.value[0].impl, signal);
	} catch {
		return io();
	}
};
/** Bridges the current workspace search with fail-closed masking and request lifetime. */
export const knowledgeSearch = (
	registry: CapabilityRegistry,
	lifetime: AbortSignal,
) => runSearch.bind(undefined, registry, lifetime);
