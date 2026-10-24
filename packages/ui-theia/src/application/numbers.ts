// A token count with a fixed k or M suffix, the same in every language: 61k, 1.2M.

/** A token count with a fixed k or M suffix. */
export const tokenCount = (n: number): string => {
	const short = (x: number) =>
		x < 10 ? x.toFixed(1).replace(/\.0$/, "") : String(Math.round(x));
	if (n < 1_000) return String(n);
	// From 999.5k on the k count would round to 1000k, so it is written in M.
	return n < 999_500 ? `${short(n / 1_000)}k` : `${short(n / 1_000_000)}M`;
};
