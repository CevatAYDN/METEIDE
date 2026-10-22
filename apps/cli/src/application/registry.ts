import type { RegistrySearchAdapter } from "@mete/contracts";
import type { App } from "../infrastructure/app.js";
import type { Io } from "./commands.js";

// The mete registry commands (ARCHITECTURE.md, CLI); each returns the process exit code.

/** `mete registry search "<words>"`: lists matching registry entries, newest versions; installs nothing. */
export const registryCommand = async (app: App, io: Io, query: string) => {
	const r = app.registry.resolve<RegistrySearchAdapter>("registry.search@1");
	if (!r.ok) {
		io.err("registry.search@1 is not active");
		return 1;
	}
	const ctl = new AbortController();
	const stop = io.onInterrupt(() => ctl.abort());
	const found = await r.value[0].impl.run({ query }, { signal: ctl.signal });
	stop();
	if (!found.ok) {
		io.err(found.error.message);
		return 1;
	}
	if (found.value.entries.length === 0) io.out(`no entries for "${query}"`);
	for (const e of found.value.entries) {
		io.out(`${e.id} ${e.version}  ${e.runtime}  ${e.source}`);
		if (e.description) io.out(`  ${e.description}`);
	}
	return 0;
};
