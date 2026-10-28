import { posix } from "node:path";
import { SLUG_MAX } from "../defaults.js";

// Where a vault note lives (docs/11, Vaults; ADR-145): its folder by type and its file name by title.

/** The workspace vault, relative to the workspace. */
export const VAULT = ".mete/knowledge";

/** The folder of each note type agents may write. */
export const FOLDERS = {
	lesson: "lessons",
	entity: "entities",
	decision: "decisions",
	journal: "journal",
} as const;

// Windows refuses these as file names, whatever the extension.
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** A note's file name from its title; empty when the title has no letter or digit. */
export const slugOf = (title: string) => {
	const slug = title
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+/, "")
		.slice(0, SLUG_MAX)
		.replace(/-+$/, "");
	return DEVICE.test(slug) ? `${slug}-note` : slug;
};

/** A .md path inside the vault, as the model gave it; undefined when it leaves the vault or enters .history/. */
export const notePath = (path: string) => {
	const p = posix.normalize(path.replaceAll("\\", "/"));
	const outside =
		posix.isAbsolute(p) ||
		/^[a-zA-Z]:/.test(p) ||
		p === ".." ||
		p.startsWith("../");
	if (outside || p.split("/")[0] === ".history" || !p.endsWith(".md"))
		return undefined;
	return p;
};
