import { createHash } from "node:crypto";
import {
	ContextAttachmentsSchema,
	type ContextDraft,
	ContextDraftSchema,
	type ContextSnapshot,
	ContextSnapshotSchema,
	type EngineError,
	err,
	type FsContextAdapter,
	FsContextOutputSchema,
	ok,
	type Result,
	type SecretsMaskAdapter,
} from "@mete/contracts";
import { z } from "zod";
import type { EngineState } from "./run-state.js";

const Masked = z.strictObject({
	text: z.string(),
	masked: z.number().int().nonnegative(),
});

/** Stable JSON field order, independent of caller property order (ADR-183). */
export const contextJson = (draft: ContextDraft) =>
	JSON.stringify({
		path: draft.path,
		content: draft.content,
		modified: draft.modified,
		...(draft.range
			? {
					range: {
						start: {
							line: draft.range.start.line,
							character: draft.range.start.character,
						},
						end: {
							line: draft.range.end.line,
							character: draft.range.end.character,
						},
					},
				}
			: {}),
	});

/** Digest identifies exactly the reviewed data, never filesystem authorization. */
export const contextHash = (draft: ContextDraft) =>
	createHash("sha256").update(contextJson(draft)).digest("hex");

const refused = (message = "Editor context is invalid; refresh its preview.") =>
	err<EngineError>({ code: "bad_input", message });

const unavailable = () =>
	err<EngineError>({
		code: "not_supported",
		message: "Editor context validation is unavailable.",
	});

const portsOf = (s: EngineState) => {
	const source = s.deps.registry.resolve<FsContextAdapter>("fs.context@1");
	const masker = s.deps.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
	return source.ok && masker.ok
		? { source: source.value[0], masker: masker.value[0] }
		: undefined;
};

const samePorts = (
	s: EngineState,
	ports: NonNullable<ReturnType<typeof portsOf>>,
) => {
	const current = portsOf(s);
	return (
		current !== undefined &&
		current.source === ports.source &&
		current.masker === ports.masker
	);
};

const prepare = async (
	s: EngineState,
	draft: ContextDraft,
	ports: ReturnType<typeof portsOf>,
): Promise<Result<ContextSnapshot, EngineError>> => {
	if (!ports) return unavailable();
	if (!samePorts(s, ports)) return refused();
	const inspected = await ports.source.impl.inspect(
		{ path: draft.path },
		new AbortController().signal,
	);
	if (!inspected.ok) return refused("Editor context source is unavailable.");
	const path = FsContextOutputSchema.safeParse(inspected.value);
	if (!path.success) return refused();
	const masked = Masked.safeParse(await ports.masker.impl.mask(draft.content));
	if (!masked.success) return refused();
	const normalized = ContextDraftSchema.safeParse({
		...draft,
		path: path.data.path,
		content: masked.data.text,
	});
	if (!normalized.success) return refused();
	if (!samePorts(s, ports)) return refused();
	return ok({ ...normalized.data, sha256: contextHash(normalized.data) });
};

/** No cache or token: every preview validates the source and masks the supplied text. */
export const prepareContext = async (
	s: EngineState,
	input: unknown,
	ports = portsOf(s),
): Promise<Result<ContextSnapshot, EngineError>> => {
	const parsed = ContextDraftSchema.safeParse(input);
	if (!parsed.success) return refused();
	try {
		return await prepare(s, parsed.data, ports);
	} catch {
		return err({
			code: "failed",
			message: "Editor context could not be prepared.",
		});
	}
};

/** Synchronous final authorization check over the adapter identities used for the whole batch. */
export type ContextAdmission = () => Result<undefined, EngineError>;

/** Fresh admission matches every reviewed snapshot and retains its exact validation adapters. */
export const validateContext = async (
	s: EngineState,
	attachments: readonly ContextSnapshot[],
): Promise<Result<ContextAdmission, EngineError>> => {
	const ports = portsOf(s);
	if (!ports) return unavailable();
	for (const attachment of attachments) {
		const { sha256, ...draft } = attachment;
		const next = await prepareContext(s, draft, ports);
		if (!next.ok) return next;
		if (
			next.value.sha256 !== sha256 ||
			contextJson(next.value) !== contextJson(draft)
		)
			return refused();
	}
	return ContextAttachmentsSchema.safeParse(attachments).success
		? ok(() => (samePorts(s, ports) ? ok(undefined) : refused()))
		: refused();
};

/** History reads mask again but do not re-inspect immutable sent sources. */
export const maskContext = async (
	masker: SecretsMaskAdapter,
	attachments: readonly ContextSnapshot[],
): Promise<ContextSnapshot[]> =>
	Promise.all(
		attachments.map(async (snapshot) => {
			const masked = Masked.parse(await masker.mask(snapshot.content));
			const { sha256: _sha256, ...source } = snapshot;
			const draft = ContextDraftSchema.parse({
				...source,
				content: masked.text,
			});
			return ContextSnapshotSchema.parse({
				...draft,
				sha256: contextHash(draft),
			});
		}),
	);
