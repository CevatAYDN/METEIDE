import {
	err,
	ok,
	type Result,
	type SkillError,
	SkillSourceDescriptorSchema,
} from "@mete/contracts";
import URI from "@theia/core/lib/common/uri";
import { z } from "zod";

/** User-initiated opening using the original descriptor from mete/skills.editor, never a display label. */
export type SkillEditorOptions = {
	readonly source: unknown;
	readonly workspace: URI;
	/** Authoritative daemon Settings.globalFile, expressed as an absolute file URI. */
	readonly globalFile?: string;
	readonly current: () => boolean;
	readonly resolve: (uri: URI) => Promise<unknown>;
	readonly open: (uri: URI) => Promise<unknown>;
};

// Native FileStat carries other fields; only these boolean kind flags are used.
const metadata = z.object({
	isFile: z.boolean(),
	isDirectory: z.boolean(),
	isSymbolicLink: z.boolean(),
});
const safeUriPath = (path: string) =>
	!path.includes("\\") && [...path].every((char) => char.charCodeAt(0) >= 0x20);
const localFileUri = (uri: URI) =>
	uri.scheme === "file" &&
	uri.path.isAbsolute &&
	!uri.query &&
	!uri.fragment &&
	safeUriPath(uri.path.toString());

const editorChain = (
	input: SkillEditorOptions,
	scope: "workspace" | "global",
	folder: string,
): URI[] | undefined => {
	let root = input.workspace;
	const segments = scope === "workspace" ? [".mete", "skills"] : ["skills"];
	if (scope === "global") {
		if (!input.globalFile || !/^file:\//u.test(input.globalFile))
			return undefined;
		const settings = new URI(input.globalFile);
		if (!localFileUri(settings) || settings.path.base !== "settings.yaml")
			return undefined;
		root = settings.parent;
	}
	const chain = [root];
	for (const segment of [...segments, folder, "SKILL.md"]) {
		root = root.resolve(segment);
		chain.push(root);
	}
	return chain;
};

const checkChain = async (
	input: SkillEditorOptions,
	chain: URI[],
): Promise<Result<URI, SkillError>> => {
	const target = chain.at(-1);
	if (!target) return err({ code: "unavailable" });
	for (const uri of chain) {
		if (!input.current()) return err({ code: "stale" });
		const raw = await input.resolve(uri);
		if (!input.current()) return err({ code: "stale" });
		const stat = metadata.safeParse(raw);
		const isFile = uri === target;
		if (
			!stat.success ||
			stat.data.isSymbolicLink ||
			stat.data.isFile !== isFile ||
			stat.data.isDirectory === isFile
		)
			return err({ code: "unavailable" });
	}
	return ok(target);
};

/** Opens only a checked local regular source; not an OS race-free sandbox. */
export const openSkillEditor = async (
	input: SkillEditorOptions,
): Promise<Result<null, SkillError>> => {
	try {
		if (!input.current()) return err({ code: "stale" });
		const source = SkillSourceDescriptorSchema.safeParse(input.source);
		if (!source.success || !localFileUri(input.workspace))
			return err({ code: "bad_input" });
		const chain = editorChain(
			input,
			source.data.scope,
			source.data.path.slice(0, -"/SKILL.md".length),
		);
		if (!chain) return err({ code: "unavailable" });
		const checked = await checkChain(input, chain);
		if (!input.current()) return err({ code: "stale" });
		if (!checked.ok) return checked;
		await input.open(checked.value);
		return input.current() ? ok(null) : err({ code: "stale" });
	} catch {
		return err({ code: input.current() ? "unavailable" : "stale" });
	}
};
