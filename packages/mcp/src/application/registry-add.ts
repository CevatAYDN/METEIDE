import {
	err,
	ok,
	type Result,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import { OFFICIAL_REGISTRY_URL, REGISTRY_TIMEOUT_MS } from "../defaults.js";
import {
	type Install,
	installOf,
	OfficialServerSchema,
} from "../domain/registry-install.js";
import { permit } from "./permit.js";
import { type RegistryDeps, readOfficial } from "./registry-search.js";

// What `mete registry add` writes for one official registry server (docs/10, Registries); the
// CLI calls it directly, since only the user, never an agent, adds a server to mcp.yaml.

/** The mcp.yaml entry for the newest version of `name`; bad_input when it cannot be added automatically. */
export const officialInstall = async (
	deps: RegistryDeps,
	name: string,
	ctx: ToolContext,
): Promise<Result<Install, ToolError>> => {
	const url = new URL(
		`${OFFICIAL_REGISTRY_URL}/${encodeURIComponent(name)}/versions/latest`,
	);
	const check = {
		adapterId: deps.adapterId,
		action: "net.fetch",
		capability: "registry.search@1",
		command: url.href,
		args: { name },
	} as const;
	const allowed = permit(deps.policy(), check, ctx);
	if (!allowed.ok) return allowed;
	const signal = AbortSignal.any([
		ctx.signal,
		AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
	]);
	const found = await readOfficial(deps, url, OfficialServerSchema, signal);
	if (!found.ok) return found;
	const install = installOf(found.value.server);
	return typeof install === "string"
		? err({ code: "bad_input", message: `${name}: ${install}` })
		: ok(install);
};
