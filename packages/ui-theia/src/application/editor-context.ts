import {
	type ContextDraft,
	ContextDraftSchema,
	type ContextRange,
	ContextRangeSchema,
	err,
	ok,
} from "@mete/contracts";
import type {
	TextEditor,
	TextEditorDocument,
} from "@theia/editor/lib/browser/editor";

/** The synchronous editor boundary reads only the explicitly chosen buffer (ADR-183). */
export type ContextEditor = Pick<TextEditor, "uri" | "selection"> & {
	readonly document: Pick<
		TextEditorDocument,
		"getText" | "dirty" | "toValidRange"
	>;
};
const unavailable = () => err({ code: "unavailable" as const });
const sameRange = (left: ContextRange, right: ContextRange) =>
	left.start.line === right.start.line &&
	left.start.character === right.start.character &&
	left.end.line === right.end.line &&
	left.end.character === right.end.character;
const isFileEditor = (
	editor: ContextEditor | undefined,
): editor is ContextEditor =>
	!!editor &&
	editor.uri.scheme === "file" &&
	!editor.uri.authority &&
	!editor.uri.query &&
	!editor.uri.fragment;

/** Capture before any focus change; Update supplies the original range, not today's selection. */
export const captureEditorContext = (
	editor: ContextEditor | undefined,
	mode: "file" | "selection",
	storedRange?: ContextRange,
) => {
	if (!isFileEditor(editor)) return unavailable();
	const selection =
		storedRange ?? (mode === "selection" ? editor.selection : undefined);
	const range = selection
		? {
				start: { ...selection.start },
				end: { ...selection.end },
			}
		: undefined;
	try {
		if (
			range &&
			(!ContextRangeSchema.safeParse(range).success ||
				!sameRange(range, editor.document.toValidRange(range)))
		)
			return unavailable();
		const input: ContextDraft = {
			path: editor.uri.path.fsPath(),
			content: editor.document.getText(range),
			modified: editor.document.dirty,
			...(range ? { range } : {}),
		};
		const parsed = ContextDraftSchema.safeParse(input);
		return parsed.success ? ok(parsed.data) : unavailable();
	} catch {
		return unavailable();
	}
};
