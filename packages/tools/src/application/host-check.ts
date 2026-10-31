import { isIP } from "node:net";
import type { ToolError } from "@mete/contracts";
import { isPublicHost } from "../domain/addresses.js";

// A public name may still point at a local address, so the web tools check what it resolves to
// (SECURITY.md, threats; ADR-171).
// shortcut: the connection resolves the name again, so a record that changes between the check and
// the connection is not caught; pin the checked address when a dispatcher that takes it is a dependency.

/** Every address a name resolves to; injected so tests never resolve a real name. */
export type Lookup = (hostname: string) => Promise<readonly string[]>;

/** Why a host may not be reached, or undefined when it and every address of its name are public. */
export const checkHost = async (
	lookup: Lookup,
	hostname: string,
): Promise<ToolError | undefined> => {
	if (!isPublicHost(hostname))
		return {
			code: "bad_input",
			message: `${hostname} is not a public address`,
		};
	const host = hostname.replace(/^\[|\]$/g, "");
	if (isIP(host) !== 0) return undefined;
	let addresses: readonly string[];
	try {
		addresses = await lookup(host);
	} catch (e) {
		const why = e instanceof Error ? e.message : String(e);
		return { code: "io", message: `${host} does not resolve: ${why}` };
	}
	if (addresses.length === 0)
		return { code: "io", message: `${host} does not resolve` };
	// The connection may use any of the addresses, so every one must be public.
	const local = addresses.find((a) => !isPublicHost(a));
	return local === undefined
		? undefined
		: {
				code: "bad_input",
				message: `${host} resolves to ${local}, which is not a public address`,
			};
};

/** Whether a page's request may go out: to the folder's own server, or a host checkHost lets through. */
export const requestGate = (lookup: Lookup, own: string | undefined) => {
	// One lookup per host for the page: a page asks the same hosts many times.
	const seen = new Map<string, Promise<boolean>>();
	return (url: string): Promise<boolean> => {
		const { hostname, origin } = new URL(url);
		if (origin === own) return Promise.resolve(true);
		const known = seen.get(hostname);
		if (known) return known;
		const pass = checkHost(lookup, hostname).then((e) => e === undefined);
		seen.set(hostname, pass);
		return pass;
	};
};
