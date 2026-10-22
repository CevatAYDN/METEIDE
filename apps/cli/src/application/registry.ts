import type {
	McpServer,
	PolicyCheckAdapter,
	RegistrySearchAdapter,
} from "@mete/contracts";
import { addMcpServer, officialInstall } from "@mete/mcp";
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

const shown = (s: McpServer) =>
	s.transport === "stdio"
		? [s.command, ...s.args].join(" ")
		: `${s.transport} ${s.url}`;

/**
 * `mete registry add <name>`: writes the newest version of an official registry server into the
 * workspace's .mete/mcp.yaml; the user runs it, never an agent (SECURITY.md, Protected paths).
 */
export const registryAddCommand = async (
	app: App,
	io: Io,
	target: { name: string; workspaceDir: string; fetch: typeof fetch },
) => {
	const policy = (): PolicyCheckAdapter | undefined => {
		const r = app.registry.resolve<PolicyCheckAdapter>("policy.check@1");
		return r.ok ? r.value[0].impl : undefined;
	};
	const deps = {
		adapterId: "official-mcp-registry",
		policy,
		fetch: target.fetch,
	};
	const ctl = new AbortController();
	const stop = io.onInterrupt(() => ctl.abort());
	const found = await officialInstall(deps, target.name, {
		signal: ctl.signal,
	});
	stop();
	if (!found.ok) {
		io.err(found.error.message);
		return 1;
	}
	const written = await addMcpServer(target.workspaceDir, found.value.server);
	if (!written.ok) {
		io.err(written.error.message);
		return 1;
	}
	io.out(
		`added ${found.value.server.id} to ${written.value}: ${shown(found.value.server)}`,
	);
	io.out(
		"the registry names no permissions for it; check what it can reach before a run uses it",
	);
	for (const note of found.value.notes) io.out(`to do: ${note}`);
	return 0;
};
