// The providers `mete key list` names, with whether each has a key (ADR-049): the CLI owns the
// list, so the desktop keeps no provider names of its own.

/** One provider of `mete key list`. */
export type ProviderKey = { readonly id: string; readonly set: boolean };

const LINE = /^(\S+)\s+(key set|no key)$/;

/** The providers of `mete key list`'s output, or undefined when a line is not one of its lines. */
export const parseKeyList = (stdout: string): ProviderKey[] | undefined => {
	const keys: ProviderKey[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const m = LINE.exec(line.trim());
		if (!m?.[1]) return undefined;
		keys.push({ id: m[1], set: m[2] === "key set" });
	}
	return keys;
};
