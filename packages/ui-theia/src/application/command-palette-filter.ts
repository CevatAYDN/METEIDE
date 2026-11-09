import {
	filterItems,
	type Match,
	type QuickPickItem,
	type QuickPicks,
} from "@theia/core/lib/common/quick-pick-service";

const textFields = ["label", "description", "detail"] as const;

function comparisonItem(original: QuickPickItem): QuickPickItem {
	const copy = { ...original };
	for (const field of textFields) {
		const text = original[field];
		if (text !== undefined) {
			copy[field] = text.toLowerCase();
		}
	}
	return copy;
}

function originalSpans(text: string): Match[] {
	const spans: Match[] = [];
	let start = 0;
	// Lowercase may expand a code point; each resulting UTF-16 unit maps to its whole source.
	for (const character of text) {
		const end = start + character.length;
		for (let unit = 0; unit < character.toLowerCase().length; unit++) {
			spans.push({ start, end });
		}
		start = end;
	}
	return spans;
}

function remapMatches(text: string, matches: Match[]): Match[] {
	const spans = originalSpans(text);
	const result: Match[] = [];
	for (const match of matches) {
		const first = spans[match.start];
		const last = spans[match.end - 1];
		if (!first || !last) {
			throw new RangeError(
				"Native quick-pick highlight is outside comparison text",
			);
		}
		const previous = result.at(-1);
		if (previous && first.start < previous.end) {
			previous.end = Math.max(previous.end, last.end);
		} else {
			result.push({ start: first.start, end: last.end });
		}
	}
	return result;
}

function restoreItem(
	original: QuickPickItem,
	comparison: QuickPickItem,
): QuickPickItem {
	const restored = { ...original };
	delete restored.highlights;
	if (comparison.highlights) {
		restored.highlights = {};
		for (const field of textFields) {
			const matches = comparison.highlights[field];
			const text = original[field];
			if (matches && text !== undefined) {
				restored.highlights[field] = remapMatches(text, matches);
			}
		}
	}
	return restored;
}

/** Filters comparison copies with Theia's native ranking, restoring original text and UTF-16 highlights without mutating inputs. */
export function filterCommandPicks(
	items: QuickPicks,
	filter: string,
): QuickPicks {
	const originals = new Map<QuickPickItem, QuickPickItem>();
	const comparisons = items.map((item) => {
		if (item.type === "separator") {
			return item;
		}
		const comparison = comparisonItem(item);
		originals.set(comparison, item);
		return comparison;
	});
	return filterItems(comparisons, filter).map((item) => {
		if (item.type === "separator") {
			return item;
		}
		const original = originals.get(item);
		if (!original) {
			throw new Error("Native quick-pick filter returned an unknown item");
		}
		return restoreItem(original, item);
	});
}
