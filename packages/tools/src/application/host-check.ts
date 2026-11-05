import { isIP } from "node:net";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { isPublicHost } from "../domain/addresses.js";

// A public name may still resolve to a local address; callers connect only to the returned address
// (SECURITY.md, threats; ADR-171).

/** Every address a name resolves to; injected so tests never resolve a real name. */
export type Lookup = (hostname: string) => Promise<readonly string[]>;

/** Resolves a hostname once and returns a public address to use for the connection. */
export const resolvePublicAddress = async (
	lookup: Lookup,
	hostname: string,
): Promise<Result<string, ToolError>> => {
	if (!isPublicHost(hostname))
		return err({
			code: "bad_input",
			message: `${hostname} is not a public address`,
		});
	const host = hostname.replace(/^\[|\]$/g, "");
	if (isIP(host) !== 0) return ok(host);
	let addresses: readonly string[];
	try {
		addresses = await lookup(host);
	} catch (e) {
		const why = e instanceof Error ? e.message : String(e);
		return err({ code: "io", message: `${host} does not resolve: ${why}` });
	}
	if (addresses.length === 0)
		return err({ code: "io", message: `${host} does not resolve` });
	const local = addresses.find(
		(address) => isIP(address) === 0 || !isPublicHost(address),
	);
	return local
		? err({
				code: "bad_input",
				message: `${host} resolves to ${local}, which is not a public address`,
			})
		: ok(addresses[0] ?? "");
};

/** Why a host may not be reached, or undefined when it and every address of its name are public. */
export const checkHost = async (
	lookup: Lookup,
	hostname: string,
): Promise<ToolError | undefined> => {
	const resolved = await resolvePublicAddress(lookup, hostname);
	return resolved.ok ? undefined : resolved.error;
};
