import { lookup } from "node:dns/promises";

/** Every address, A and AAAA, the system resolves a name to (ADR-171). */
export const lookupAll = async (hostname: string): Promise<readonly string[]> =>
	(await lookup(hostname, { all: true })).map((a) => a.address);
