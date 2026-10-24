// The providers `mete key list` names, with whether each has a key (ADR-049), its kind and the page
// where the user gets a key (ADR-088): the CLI owns the list, so the desktop keeps no provider names.

/** One provider of `mete key list`. */
export type ProviderKey = {
	readonly id: string;
	readonly set: boolean;
	readonly kind: "model" | "search";
	readonly keyPage: string;
};

// The page opens in the system browser, so only an https address is taken.
const LINE = /^(\S+)\s+(key set|no key)\s+(model|search)\s+(https:\/\/\S+)$/;

/** The providers of `mete key list`'s output, or undefined when a line is not one of its lines. */
export const parseKeyList = (stdout: string): ProviderKey[] | undefined => {
	const keys: ProviderKey[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const m = LINE.exec(line.trim());
		if (!m?.[1] || !m[4]) return undefined;
		keys.push({
			id: m[1],
			set: m[2] === "key set",
			kind: m[3] === "search" ? "search" : "model",
			keyPage: m[4],
		});
	}
	return keys;
};
