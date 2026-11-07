import { err, type RegistrySetupAdapter } from "@mete/contracts";
import { z } from "zod";
import { OFFICIAL_REGISTRY_URL, REGISTRY_TIMEOUT_MS } from "../defaults.js";
import { setupOf } from "../domain/registry-setup.js";
import { permit } from "./permit.js";
import { type RegistryDeps, readOfficial } from "./registry-search.js";

/** Read-only structured setup through the existing official registry policy/fetch port. */
export const officialSetup = (deps: RegistryDeps): RegistrySetupAdapter => ({
	prepare: async (raw, ctx) => {
		const name = z
			.string()
			.min(1)
			.regex(/^[A-Za-z0-9._/-]+$/)
			.safeParse(raw);
		if (!name.success)
			return err({ code: "bad_input", message: "Invalid registry name." });
		const url = new URL(
			`${OFFICIAL_REGISTRY_URL}/${encodeURIComponent(name.data)}/versions/latest`,
		);
		const allowed = permit(
			deps.policy(),
			{
				adapterId: deps.adapterId,
				action: "net.fetch",
				capability: "registry.search@1",
				command: url.href,
				args: { name: name.data },
			},
			ctx,
		);
		if (!allowed.ok) return allowed;
		const signal = AbortSignal.any([
			ctx.signal,
			AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
		]);
		const found = await readOfficial(deps, url, z.unknown(), signal);
		// HTTP bodies and fetch exceptions can contain registry-supplied secrets.
		if (!found.ok)
			return err({
				code: found.error.code === "not_found" ? "not_found" : "io",
				message:
					"Official registry setup could not be read; retry or choose another entry.",
			});
		return setupOf(found.value, url.href);
	},
});
