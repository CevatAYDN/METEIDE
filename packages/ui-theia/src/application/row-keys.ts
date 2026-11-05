import { useRef } from "react";

// Stable React keys for an editable list whose rows have no id of their own (a binding while its
// capability is typed, an endpoint while its slug is typed, two new members with the same id). A
// parallel list of ids follows the rows: a grown list appends ids, a reported removal drops that
// row's id, and surviving rows keep theirs, so a row's half-typed text never moves to its neighbour.

/** The keys for a list's rows, and how the list reports a removal. */
export type RowKeys = {
	/** One key per row, as long as the list the last `fit` saw. */
	readonly keys: readonly string[];
	/** The row at `index` is leaving; the keys after it keep their ids. */
	readonly remove: (index: number) => void;
};

let next = 0;

const fresh = (): string => `row-${++next}`;

/**
 * Keeps ids aligned to a list of `length` rows: `fit` appends ids for new rows and, when the list
 * shrank without a reported removal, drops the ids at the end.
 */
export const rowKeys = (): RowKeys & {
	readonly fit: (length: number) => readonly string[];
} => {
	let ids: string[] = [];
	return {
		get keys() {
			return ids;
		},
		fit: (length) => {
			if (ids.length > length) ids = ids.slice(0, length);
			while (ids.length < length) ids.push(fresh());
			return ids;
		},
		remove: (index) => {
			ids = ids.filter((_, at) => at !== index);
		},
	};
};

/** The hook form: the keys for a list of `length` rows this render, and `remove` for its Remove buttons. */
export const useRowKeys = (length: number): RowKeys => {
	const store = useRef<ReturnType<typeof rowKeys> | undefined>(undefined);
	store.current ??= rowKeys();
	return { keys: store.current.fit(length), remove: store.current.remove };
};

/** The actions with their `onRemove` telling the keys first, so the surviving rows keep theirs. */
export const withRowKeys = <
	A extends { readonly onRemove: (index: number) => void },
>(
	actions: A,
	keyed: RowKeys,
): A => ({
	...actions,
	onRemove: (index: number) => {
		keyed.remove(index);
		actions.onRemove(index);
	},
});

/**
 * Keys from the rows' own names for a read-only list: a repeated name (two new members with the
 * same id, two tasks with the same title, until the schema refuses it) gets its repeat count.
 */
export const uniqueKeys = (names: readonly string[]): readonly string[] => {
	const seen = new Map<string, number>();
	return names.map((name) => {
		const n = seen.get(name) ?? 0;
		seen.set(name, n + 1);
		return n === 0 ? name : `${name}#${n}`;
	});
};
