import {
	err,
	ok,
	type Result,
	SKILL_LIMITS,
	type SkillCatalogAdapter,
	type SkillCatalogList,
	type SkillError,
	SkillErrorSchema,
	type SkillInspection,
	type SkillSourceAdapter,
	type SkillSourceDescriptor,
	SkillSourceInputSchema,
	SkillSourceListSchema,
	type SkillSourceSnapshot,
	SkillSourceSnapshotSchema,
} from "@mete/contracts";
import type { Adapter, CapabilityRegistry } from "@mete/kernel";
import { z } from "zod";
import { parseSkill } from "../domain/skill-parser.js";

type Owner = {
	adapter: Adapter<SkillSourceAdapter>;
	impl: SkillSourceAdapter;
};
/** Composition attests actual native implementations, never registry labels. */
export type NativeSkillSources = Pick<WeakSet<SkillSourceAdapter>, "has">;
const unavailable = (code: SkillError["code"] = "unavailable") =>
	err<SkillError>({ code, location: "source" });
const key = ({ scope, path, sourceId }: SkillSourceDescriptor) =>
	`${scope}\0${path}\0${sourceId}`;
const SourceResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({ ok: z.literal(true), value: z.unknown() }),
	z.strictObject({ ok: z.literal(false), error: SkillErrorSchema }),
]);

function append(
	output: SkillCatalogList,
	inspected: Result<SkillInspection, SkillError>,
): Result<void, SkillError> {
	if (!inspected.ok) {
		output.diagnostics.push(inspected.error);
		if (inspected.error.code === "limit_exceeded") output.complete = false;
		return ok(undefined);
	}
	if (output.entries.length === SKILL_LIMITS.catalogEntries) {
		return unavailable("limit_exceeded");
	}
	const { source, metadata } = inspected.value;
	output.entries.push({ source, metadata });
	return ok(undefined);
}

class Catalog implements SkillCatalogAdapter {
	constructor(
		private readonly registry: CapabilityRegistry,
		private readonly native: NativeSkillSources,
	) {}

	private current(owner: Owner): boolean {
		const resolved =
			this.registry.resolve<SkillSourceAdapter>("skill.source@1");
		return (
			resolved.ok &&
			resolved.value[0] === owner.adapter &&
			resolved.value[0].impl === owner.impl &&
			this.native.has(owner.impl)
		);
	}

	private async perform<T>(
		signal: AbortSignal,
		work: (owner: Owner) => Promise<Result<T, SkillError>>,
	): Promise<Result<T, SkillError>> {
		try {
			if (signal.aborted) return unavailable("aborted");
			const resolved =
				this.registry.resolve<SkillSourceAdapter>("skill.source@1");
			if (!resolved.ok || !this.native.has(resolved.value[0].impl)) {
				return unavailable();
			}
			const owner = {
				adapter: resolved.value[0],
				impl: resolved.value[0].impl,
			};
			const result = await work(owner);
			if (signal.aborted) return unavailable("aborted");
			return this.current(owner) ? result : unavailable();
		} catch {
			return unavailable(signal.aborted ? "aborted" : "unavailable");
		}
	}

	private async checked<T>(
		schema: z.ZodType<T>,
		load: () => Promise<unknown>,
		owner: Owner,
		signal: AbortSignal,
	): Promise<Result<T, SkillError>> {
		if (signal.aborted) return unavailable("aborted");
		if (!this.current(owner)) return unavailable();
		const raw = await load();
		if (signal.aborted) return unavailable("aborted");
		if (!this.current(owner)) return unavailable();
		const envelope = SourceResultSchema.safeParse(raw);
		if (!envelope.success) return unavailable();
		if (!envelope.data.ok) return err(envelope.data.error);
		const value = schema.safeParse(envelope.data.value);
		return value.success ? ok(value.data) : unavailable();
	}

	private async snapshot(
		sourceId: string,
		owner: Owner,
		signal: AbortSignal,
	): Promise<Result<SkillSourceSnapshot, SkillError>> {
		const result = await this.checked(
			SkillSourceSnapshotSchema,
			() => owner.impl.read({ sourceId }, signal),
			owner,
			signal,
		);
		if (!result.ok) return err({ ...result.error, sourceId });
		return result.value.source.sourceId === sourceId
			? result
			: err({ code: "stale", sourceId, location: "source" });
	}

	private async read(
		source: SkillSourceDescriptor,
		owner: Owner,
		signal: AbortSignal,
	): Promise<Result<SkillInspection, SkillError>> {
		const result = await this.snapshot(source.sourceId, owner, signal);
		if (!result.ok) return result;
		if (key(result.value.source) !== key(source)) {
			return err({
				code: "stale",
				sourceId: source.sourceId,
				location: "source",
			});
		}
		const parsed = parseSkill(result.value);
		return parsed.ok
			? parsed
			: err({ ...parsed.error, sourceId: source.sourceId });
	}

	private async inventory(
		owner: Owner,
		signal: AbortSignal,
	): Promise<Result<SkillCatalogList, SkillError>> {
		const listed = await this.checked(
			SkillSourceListSchema,
			() => owner.impl.list(signal),
			owner,
			signal,
		);
		if (!listed.ok) return listed;
		const output: SkillCatalogList = {
			entries: [],
			complete: listed.value.complete,
			diagnostics: [...listed.value.diagnostics],
		};
		const sources = [...listed.value.sources].sort((a, b) =>
			key(a) < key(b) ? -1 : 1,
		);
		for (const source of sources) {
			const inspected = await this.read(source, owner, signal);
			if (signal.aborted) return unavailable("aborted");
			if (!this.current(owner)) return unavailable();
			const added = append(output, inspected);
			if (!added.ok) return added;
		}
		return ok(output);
	}

	readonly list: SkillCatalogAdapter["list"] = (signal) =>
		this.perform(signal, (owner) => this.inventory(owner, signal));

	readonly inspect: SkillCatalogAdapter["inspect"] = (input, signal) =>
		this.perform(signal, async (owner) => {
			const parsed = SkillSourceInputSchema.safeParse(input);
			if (!parsed.success) return unavailable("bad_input");
			const snapshot = await this.snapshot(parsed.data.sourceId, owner, signal);
			return snapshot.ok ? parseSkill(snapshot.value) : snapshot;
		});
}

/** User-management catalog; resolves and revalidates the native source per call. */
export const createSkillCatalog = (
	registry: CapabilityRegistry,
	nativeSources: NativeSkillSources,
): SkillCatalogAdapter => new Catalog(registry, nativeSources);
