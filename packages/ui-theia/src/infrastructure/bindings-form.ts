import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import type {
	BindingsActions,
	BindingsState,
} from "../application/bindings-card.js";
import {
	type BindingsDraft,
	type BindingsRow,
	bindingsOf,
	bindingsText,
} from "../application/bindings-draft.js";
import type { Target } from "../application/section-draft.js";
import type { SaveNote } from "../application/settings-form.js";
import { textOf, writeText } from "./settings-forms.js";

// The bindings card's file (ADR-096), read and written through Theia's file service on the user's
// click only (ADR-072). This folder's .mete/bindings.yaml is the default, as ADR-082's forms; the
// other target is the bindings key of the global settings.yaml. The scope switch moves the card and
// the save bar saves it, so it has no target choice and no Save of its own.

const EMPTY: BindingsRow = { capability: "", adapters: "" };

export class BindingsForm {
	protected state: BindingsState | undefined;
	protected root: URI | undefined;
	protected globalFile: string | undefined;

	constructor(
		protected readonly files: FileService,
		protected readonly onChange: () => void,
	) {}

	/** Reads the card's file again, for the open folder and the global settings file. */
	async load(root: URI | undefined, globalFile: string | undefined) {
		this.root = root;
		this.globalFile = globalFile;
		await this.read(this.state?.target ?? "workspace");
	}

	/** The card's state and actions, for the view. */
	form(): { state: BindingsState; actions: BindingsActions } | undefined {
		if (!this.state) return undefined;
		return {
			state: this.state,
			actions: {
				onRow: (i, key, value) =>
					this.edit((rows) =>
						rows.map((row, at) => (at === i ? { ...row, [key]: value } : row)),
					),
				onAdd: () => this.edit((rows) => [...rows, EMPTY]),
				onRemove: (i) => this.edit((rows) => rows.filter((_, at) => at !== i)),
			},
		};
	}

	protected fileOf(target: Target) {
		if (target === "global")
			return this.globalFile ? URI.fromFilePath(this.globalFile) : undefined;
		return this.root?.resolve(".mete/bindings.yaml");
	}

	/** The scope switch (ADR-095): the card shows the other target, keeping what was typed. */
	async retarget(target: Target) {
		const typed = this.state?.dirty ? this.state.rows : undefined;
		await this.read(target, undefined, typed);
	}

	/** The save bar (ADR-095): writes the rows, or removes them from the file when it has none. */
	async save() {
		const state = this.state;
		const file = state && this.fileOf(state.target);
		if (!state || !file || state.busy) return;
		this.state = { ...state, busy: true };
		this.onChange();
		try {
			const before = await textOf(this.files, file);
			const r = bindingsText(before, state.target, state.rows);
			if (!r.ok) return this.refused(r.error);
			await writeText(this.files, file, before, r.value);
			const text = nls.localize(
				"mete/settings/saved",
				"Saved to {0}; it applies when METE starts again.",
				file.path.fsPath(),
			);
			await this.read(state.target, { kind: "saved", text });
		} catch (e) {
			this.refused(String(e));
		}
	}

	protected async read(target: Target, note?: SaveNote, typed?: BindingsDraft) {
		const file = this.fileOf(target);
		const listed = bindingsOf(
			file ? await textOf(this.files, file) : undefined,
			target,
		);
		this.state = {
			target,
			file: file?.path.fsPath(),
			rows: typed ?? (listed.ok ? listed.value : []),
			busy: false,
			dirty: typed !== undefined,
			note: listed.ok ? note : { kind: "refused", text: listed.error },
		};
		this.onChange();
	}

	protected edit(change: (rows: BindingsDraft) => BindingsDraft) {
		if (!this.state) return;
		this.state = {
			...this.state,
			rows: change(this.state.rows),
			dirty: true,
			note: undefined,
		};
		this.onChange();
	}

	protected refused(reason: string) {
		if (!this.state) return;
		const text = nls.localize(
			"mete/settings/notSaved",
			"Not saved: {0}",
			reason,
		);
		this.state = {
			...this.state,
			busy: false,
			note: { kind: "refused", text },
		};
		this.onChange();
	}
}
