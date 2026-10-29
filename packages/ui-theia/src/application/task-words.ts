import type { Place } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";

// The Board's words for where a task stands (ADR-051), shared by its columns and the rail's Tasks
// tab (ADR-119), so a task reads the same in both.

export const columnName = (column: Place["column"]) =>
	({
		todo: nls.localize("mete/board/todo", "To do"),
		in_progress: nls.localize("mete/board/inProgress", "In progress"),
		done: nls.localize("mete/board/done", "Done"),
	})[column];

export const markerText = (marker: NonNullable<Place["marker"]>) =>
	({
		in_review: nls.localize("mete/board/inReview", "In review"),
		changes_asked: nls.localize("mete/board/changesAsked", "Changes asked"),
		blocked: nls.localize("mete/board/blocked", "Blocked"),
		not_merged: nls.localize("mete/board/notMerged", "Not merged"),
	})[marker];

/** Where a task stands in one word: its marker when it has one, else its column. */
export const placeWord = (place: Place) =>
	place.marker ? markerText(place.marker) : columnName(place.column);
