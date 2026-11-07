// Lenient verify entries stay untouched unless their command changes (docs/13, F5 lossless editing).

const commandOf = (g: unknown) =>
	typeof g === "object" && g !== null && "run" in g && typeof g.run === "string"
		? g.run
		: undefined;

/** The shell commands among a task's verify gates. */
export const runsOf = (verify: readonly unknown[]): string[] =>
	verify.flatMap((g) => {
		const run = commandOf(g);
		return run === undefined ? [] : [run];
	});

/**
 * Edits command slots without moving other gates. Retained commands keep their fields; replacements
 * keep the slot's fields, additions append, and undefined means no gate is left.
 */
export const withRuns = (
	verify: readonly unknown[],
	runs: readonly string[],
) => {
	const commands = verify.filter((g) => commandOf(g) !== undefined);
	const take = (run: string, replaced?: unknown): unknown => {
		const i = commands.findIndex((g) => commandOf(g) === run);
		if (i >= 0) return commands.splice(i, 1)[0];
		return {
			...(typeof replaced === "object" && replaced !== null ? replaced : {}),
			run,
		};
	};
	let index = 0;
	const next = verify.flatMap((g): unknown[] => {
		const old = commandOf(g);
		if (old === undefined) return [g];
		const run = runs[index];
		if (run === undefined) return [];
		if (!runs.includes(old) && commands.some((c) => commandOf(c) === run))
			return [];
		index++;
		return [take(run, g)];
	});
	next.push(...runs.slice(index).map((run) => take(run)));
	return next.length > 0 ? next : undefined;
};
