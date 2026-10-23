import { listTemplates, type TemplateDirs } from "@mete/core";
import type { Io } from "./commands.js";

// `mete template validate [<id>]`: loads the team templates the router may pick, from the workspace's
// .mete/teams/ and the built-in folder, as a run would, and names each issue of one that does not load.

/** Prints `<id>  ok` per template that loads and `<id>  <issue>` on standard error per issue. */
export const templateValidate = async (
	dirs: TemplateDirs,
	io: Io,
	id?: string,
) => {
	const { templates, broken } = await listTemplates(dirs);
	const good = templates.filter(
		(t) => id === undefined || t.metadata.id === id,
	);
	const bad = broken.filter((b) => id === undefined || b.id === id);
	if (good.length + bad.length === 0) {
		io.err(id === undefined ? "no team templates" : `no template ${id}`);
		return 1;
	}
	for (const t of good) io.out(`${t.metadata.id}  ok`);
	for (const b of bad) {
		const issues = "issues" in b.error ? b.error.issues : [b.error.message];
		for (const issue of issues) io.err(`${b.id}  ${issue}`);
	}
	return bad.length > 0 ? 1 : 0;
};
