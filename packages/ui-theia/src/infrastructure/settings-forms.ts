import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import {
	type Draft,
	defaultsOf,
	draftOf,
	type FieldValue,
	FORM_FIELDS,
	type FormSection,
	savedText,
	type Target,
} from "../application/section-draft.js";
import type { FormState } from "../application/settings-form.js";
import type { Forms } from "../application/settings-view.js";

// The Settings forms' files (ADR-082), read and written through Theia's file service on the user's
// click only (ADR-072). A form starts from its target file as it is now, keeps which keys the user
// changed, and Save writes those into the file read again just before, so nothing else is lost.

const SECTIONS: readonly FormSection[] = ["gateway", "privacy", "policy"];

/** A configuration file's text, or undefined when it does not exist. */
export const textOf = async (files: FileService, file: URI) =>
	(await files.exists(file)) ? (await files.read(file)).value : undefined;

export class SettingsForms {
	protected readonly states = new Map<FormSection, FormState>();
	protected readonly changed = new Map<FormSection, Set<string>>();
	protected root: URI | undefined;
	protected globalFile: string | undefined;

	constructor(
		protected readonly files: FileService,
		protected readonly onChange: () => void,
	) {}

	/** Reads every form's file again, for the open folder and the global settings file. */
	async load(root: URI | undefined, globalFile: string | undefined) {
		this.root = root;
		this.globalFile = globalFile;
		for (const s of SECTIONS)
			await this.read(s, this.states.get(s)?.target ?? "workspace");
	}

	/** Every form with its state and actions, for the view. */
	forms(): Forms {
		return Object.fromEntries(
			[...this.states].map(([section, state]) => [
				section,
				{
					state,
					actions: {
						onField: (key: string, value: FieldValue) =>
							this.field(section, key, value),
						onTarget: (target: Target) => void this.retarget(section, target),
						onSave: () => void this.save(section),
						onClear: () => void this.clear(section),
					},
				},
			]),
		);
	}

	protected fileOf(section: FormSection, target: Target) {
		if (target === "global")
			return this.globalFile ? URI.fromFilePath(this.globalFile) : undefined;
		return this.root?.resolve(`.mete/${section}.yaml`);
	}

	protected textOf(file: URI) {
		return textOf(this.files, file);
	}

	// What the user typed in a form since its file was read.
	protected keptOf(section: FormSection): Draft {
		const state = this.states.get(section);
		return Object.fromEntries(
			[...(this.changed.get(section) ?? [])].map((k) => [k, state?.values[k]]),
		);
	}

	// Another target keeps what the user typed, over that file's own values.
	protected retarget(section: FormSection, target: Target) {
		return this.read(section, target, undefined, this.keptOf(section));
	}

	/** The scope switch (ADR-095): every form saves to the other target. */
	async retargetAll(target: Target) {
		await Promise.all(SECTIONS.map((s) => this.retarget(s, target)));
	}

	/** The save bar (ADR-095): every changed form saves to its own file, one after the other. */
	async saveAll() {
		for (const s of SECTIONS) if (this.states.get(s)?.dirty) await this.save(s);
	}

	// Reset: the form's keys leave this folder's file, so the global file's value or the default
	// applies again. A form that shows this folder's file drops its typing, which the clear replaces.
	protected async clear(section: FormSection) {
		const state = this.states.get(section);
		const file = this.fileOf(section, "workspace");
		if (!state || !file || state.busy) return;
		const cleared: Draft = Object.fromEntries(
			FORM_FIELDS[section].map((f) => [f.path.join("."), undefined]),
		);
		try {
			const r = savedText(
				await this.textOf(file),
				section,
				"workspace",
				cleared,
			);
			if (!r.ok) return this.refused(section, r.error);
			await this.files.write(file, r.value);
			const text = nls.localize(
				"mete/settings/cleared",
				"Cleared in {0}; it applies when METE starts again.",
				file.path.fsPath(),
			);
			const kept = state.target === "workspace" ? {} : this.keptOf(section);
			await this.read(section, state.target, { kind: "saved", text }, kept);
		} catch (e) {
			this.refused(section, String(e));
		}
	}

	protected async read(
		section: FormSection,
		target: Target,
		note?: FormState["note"],
		kept: Draft = {},
	) {
		const file = this.fileOf(section, target);
		const draft = draftOf(
			file ? await this.textOf(file) : undefined,
			section,
			target,
		);
		this.states.set(section, {
			target,
			file: file?.path.fsPath(),
			values: { ...(draft.ok ? draft.value : {}), ...kept },
			defaults: defaultsOf(section),
			busy: false,
			dirty: Object.keys(kept).length > 0,
			note: draft.ok ? note : { kind: "refused", text: draft.error },
		});
		this.changed.set(section, new Set(Object.keys(kept)));
		this.onChange();
	}

	protected field(section: FormSection, key: string, value: FieldValue) {
		const state = this.states.get(section);
		if (!state) return;
		this.states.set(section, {
			...state,
			values: { ...state.values, [key]: value },
			dirty: true,
			note: undefined,
		});
		this.changed.get(section)?.add(key);
		this.onChange();
	}

	protected async save(section: FormSection) {
		const state = this.states.get(section);
		const file = state && this.fileOf(section, state.target);
		if (!state || !file || state.busy) return;
		this.states.set(section, { ...state, busy: true });
		this.onChange();
		const keys = [...(this.changed.get(section) ?? [])];
		const changes: Draft = Object.fromEntries(
			keys.map((k) => [k, state.values[k]]),
		);
		try {
			const r = savedText(
				await this.textOf(file),
				section,
				state.target,
				changes,
			);
			if (!r.ok) return this.refused(section, r.error);
			await this.files.write(file, r.value);
			const text = nls.localize(
				"mete/settings/saved",
				"Saved to {0}; it applies when METE starts again.",
				file.path.fsPath(),
			);
			await this.read(section, state.target, { kind: "saved", text });
		} catch (e) {
			this.refused(section, String(e));
		}
	}

	protected refused(section: FormSection, reason: string) {
		const state = this.states.get(section);
		if (!state) return;
		const text = nls.localize(
			"mete/settings/notSaved",
			"Not saved: {0}",
			reason,
		);
		this.states.set(section, {
			...state,
			busy: false,
			note: { kind: "refused", text },
		});
		this.onChange();
	}
}
