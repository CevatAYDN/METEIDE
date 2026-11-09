import {
	err,
	ok,
	type Result,
	type SecretsMaskAdapter,
	type SkillCatalogAdapter,
	type SkillError,
	SkillErrorSchema,
	type SkillInspection,
	SkillInspectionSchema,
	type SkillSourceAdapter,
	type SkillSourceDescriptor,
	SkillSourceDescriptorSchema,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { z } from "zod";
import { maskSkillFrontmatter } from "./skill-masking.js";

/** Composition-owned native identities; adapter names and trust labels are not attestations. */
export type SkillReaderOptions = {
	readonly registry: CapabilityRegistry;
	readonly nativeSources: WeakSet<SkillSourceAdapter>;
	readonly nativeCatalogs: WeakSet<SkillCatalogAdapter>;
};
/** Captured implementations and a check retaining the exact registry objects too. */
export type SkillReaders = {
	readonly source: SkillSourceAdapter;
	readonly catalog: SkillCatalogAdapter;
	readonly masker: SecretsMaskAdapter;
	readonly current: () => boolean;
};
/** Safe failures never include native exceptions or source text. */
export const skillFailure = (code: SkillError["code"] = "unavailable") =>
	err<SkillError>({ code });

/** Captures the selected adapters once, with no fallback to unattested implementations. */
export const captureSkillReaders = (
	opts: SkillReaderOptions,
): Result<SkillReaders, SkillError> => {
	try {
		const source = opts.registry.resolve<SkillSourceAdapter>("skill.source@1");
		const catalog =
			opts.registry.resolve<SkillCatalogAdapter>("skill.catalog@1");
		const masker = opts.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
		if (!source.ok || !catalog.ok || !masker.ok) return skillFailure();
		const s = source.value[0],
			c = catalog.value[0],
			m = masker.value[0];
		const si = s.impl,
			ci = c.impl,
			mi = m.impl;
		const bindings = [
			["skill.source@1", s, si],
			["skill.catalog@1", c, ci],
			["secrets.mask@1", m, mi],
		] as const;
		const current = () =>
			opts.nativeSources.has(si) &&
			opts.nativeCatalogs.has(ci) &&
			bindings.every(([ref, adapter, impl]) => {
				const found = opts.registry.resolve(ref);
				return found.ok && found.value[0] === adapter && adapter.impl === impl;
			});
		return current()
			? ok({ source: si, catalog: ci, masker: mi, current })
			: skillFailure();
	} catch {
		return skillFailure();
	}
};

/** Validates the complete Result envelope and checks cancellation/identity across every await. */
export const callSkill = async <T>(
	readers: SkillReaders,
	signal: AbortSignal,
	schema: z.ZodType<T>,
	run: () => Promise<unknown>,
): Promise<Result<T, SkillError>> => {
	try {
		if (signal.aborted) return skillFailure("aborted");
		if (!readers.current()) return skillFailure("stale");
		const raw: unknown = await run();
		if (signal.aborted) return skillFailure("aborted");
		if (!readers.current()) return skillFailure("stale");
		const parsed = z
			.discriminatedUnion("ok", [
				z.strictObject({ ok: z.literal(true), value: schema }),
				z.strictObject({ ok: z.literal(false), error: SkillErrorSchema }),
			])
			.safeParse(raw);
		return parsed.success ? parsed.data : skillFailure();
	} catch {
		return skillFailure(signal.aborted ? "aborted" : "unavailable");
	}
};
const MaskSchema = z.strictObject({
	text: z.string(),
	masked: z.number().int().nonnegative(),
});
const maskText = async (r: SkillReaders, text: string, signal: AbortSignal) => {
	const result = await callSkill(r, signal, MaskSchema, () =>
		r.masker.mask(text).then(ok),
	);
	return result.ok ? ok(result.value.text) : result;
};
const addMaskedField = (
	fields: Map<string, string>,
	name: string,
	text: Result<string, SkillError>,
): Result<void, SkillError> => {
	if (!text.ok) return text;
	if (fields.has(name)) return skillFailure();
	fields.set(name, text.value);
	return ok(undefined);
};
type MaskedFieldOptions = { keys?: boolean; values: Map<string, string> };
const rememberMaskedField = (
	options: MaskedFieldOptions,
	original: readonly [string, string],
	name: string,
	text: Result<string, SkillError>,
) => {
	if (options.keys) options.values.set(original[0], name);
	if (text.ok) options.values.set(original[1], text.value);
};
const maskFields = async (
	r: SkillReaders,
	fields: Readonly<Record<string, string | undefined>>,
	signal: AbortSignal,
	options: MaskedFieldOptions,
): Promise<Result<Record<string, string>, SkillError>> => {
	const result = new Map<string, string>();
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined) continue;
		const name = options.keys ? await maskText(r, key, signal) : ok(key);
		if (!name.ok) return name;
		const text = await maskText(r, value, signal);
		const added = addMaskedField(result, name.value, text);
		if (!added.ok) return added;
		rememberMaskedField(options, [key, value], name.value, text);
	}
	return ok(Object.fromEntries(result));
};

/** Masks only the display path, retaining opaque identity and scope. */
export const maskSkillSource = async (
	r: SkillReaders,
	source: SkillSourceDescriptor,
	signal: AbortSignal,
) =>
	callSkill(r, signal, SkillSourceDescriptorSchema, async () => {
		const path = await maskText(r, source.path, signal);
		return path.ok ? ok({ ...source, path: path.value }) : path;
	});

const maskInspectionText = async (
	r: SkillReaders,
	text: string,
	values: ReadonlyMap<string, string>,
	signal: AbortSignal,
) => {
	const frontmatter = maskSkillFrontmatter(text, values);
	if (!frontmatter.ok) return frontmatter;
	const masked = await maskText(r, frontmatter.value, signal);
	return masked.ok ? maskSkillFrontmatter(masked.value, new Map()) : masked;
};

const rebuildMaskedInspection = async (
	r: SkillReaders,
	inspection: SkillInspection,
	signal: AbortSignal,
) => {
	const parsed = SkillInspectionSchema.safeParse(inspection);
	if (!parsed.success) return skillFailure();
	const { metadata, ...fields } = parsed.data.metadata;
	const values = new Map<string, string>();
	const masked = await maskFields(r, fields, signal, { values });
	if (!masked.ok) return masked;
	const pairs = await maskFields(r, metadata ?? {}, signal, {
		keys: true,
		values,
	});
	if (!pairs.ok) return pairs;
	const text = await maskInspectionText(r, parsed.data.text, values, signal);
	if (!text.ok) return text;
	const source = await maskSkillSource(r, parsed.data.source, signal);
	if (!source.ok) return source;
	return ok({
		...parsed.data,
		source: source.value,
		text: text.value,
		metadata: {
			...masked.value,
			...(metadata === undefined ? {} : { metadata: pairs.value }),
		},
	});
};

/** Masks decoded scalars and full actual text while preserving the raw-byte digest. */
export const maskSkillInspection = async (
	r: SkillReaders,
	inspection: SkillInspection,
	signal: AbortSignal,
): Promise<Result<SkillInspection, SkillError>> =>
	callSkill(r, signal, SkillInspectionSchema, () =>
		rebuildMaskedInspection(r, inspection, signal),
	);
