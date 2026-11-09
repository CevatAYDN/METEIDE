import { err, ok } from "@mete/contracts";
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
	hasKeys,
	inheritedDefaults,
	savedLayeredText,
	type Target,
} from "../application/section-draft.js";
import type { FormState } from "../application/settings-form.js";
import type { Forms } from "../application/settings-view.js";

// The Settings forms' files (ADR-082), read and written through Theia's file service on the user's
// click only (ADR-072). A form starts from its target file as it is now, keeps which keys the user
// changed, and Save writes those into the file read again just before, so nothing else is lost.

const SECTIONS = ["gateway", "privacy", "policy", "shell"] as const;
const reportSaveFailure = (current: () => boolean, report: () => void) => {
	if (current()) report();
};

/** A configuration file's text, or undefined when it does not exist. */
export const textOf = async (files: FileService, file: URI) =>
	(await files.exists(file)) ? (await files.read(file)).value : undefined;

/**
 * Writes a file's new text. A file the edit leaves with no key is deleted, since an empty file is
 * still a layer that sets nothing; a file that held no key is left as it is (ADR-095).
 */
export const writeText = async (
	files: FileService,
	file: URI,
	before: string | undefined,
	after: string,
) => {
	if (after !== "") await files.write(file, after);
	else if (hasKeys(before)) await files.delete(file);
};

export class SettingsForms {
	protected readonly states = new Map<FormSection, FormState>();
	protected readonly changed = new Map<FormSection, Set<string>>();
	protected readonly contexts = new Map<FormSection, object>();
	protected generation = 0;
	protected targetRevision = 0;
	protected root: URI | undefined;
	protected globalFile: string | undefined;

	constructor(
		protected readonly files: FileService,
		protected readonly onChange: () => void,
	) {}

	/** Retires old reads and user actions before resolving a replacement workspace. */
	invalidate(): void {
		this.generation++;
		this.contexts.clear();
		this.states.clear();
		this.changed.clear();
		this.root = undefined;
		this.globalFile = undefined;
	}

	/** Reads every form's file again, for the open folder and the global settings file. */
	async load(root: URI | undefined, globalFile: string | undefined) {
		const targets = new Map(
			[...this.states].map(([key, state]) => [key, state.target]),
		);
		this.invalidate();
		const generation = this.generation;
		this.root = root;
		this.globalFile = globalFile;
		for (const s of SECTIONS) {
			if (generation !== this.generation) return;
			await this.read(s, targets.get(s) ?? "workspace");
		}
	}

	protected current(section: FormSection, token: object | undefined) {
		return token !== undefined && this.contexts.get(section) === token;
	}

	protected release(section: FormSection, token: object | undefined) {
		const state = this.states.get(section);
		if (!this.current(section, token) || !state?.busy) return;
		this.states.set(section, { ...state, busy: false });
		this.onChange();
	}

	/** Every form with its state and actions, for the view. */
	forms(): Forms {
		return Object.fromEntries(
			[...this.states].map(([section, state]) => {
				const run = this.guard(section);
				return [
					section,
					{
						state,
						actions: {
							onField: (key: string, value: FieldValue) =>
								run(() => this.field(section, key, value)),
							onTarget: (target: Target) =>
								run(() => void this.retarget(section, target)),
							onSave: () => run(() => void this.save(section)),
							onClear: () => run(() => void this.clear(section)),
						},
					},
				];
			}),
		);
	}

	protected guard(section: FormSection) {
		const token = this.contexts.get(section);
		return (action: () => void) => {
			if (this.current(section, token) && !this.states.get(section)?.busy)
				action();
		};
	}

	protected fileOf(section: FormSection, target: Target) {
		if (target === "global")
			return this.globalFile ? URI.fromFilePath(this.globalFile) : undefined;
		return this.root?.resolve(`.mete/${section}.yaml`);
	}

	protected textOf(file: URI) {
		return textOf(this.files, file);
	}

	// The file edited in place (savedText), written as writeText writes it.
	protected async edit(input: {
		file: URI;
		section: FormSection;
		target: Target;
		changes: Draft;
		current: () => boolean;
	}) {
		const { file, section, target, changes } = input;
		const globalFile = this.globalFile;
		const before = await this.textOf(file);
		if (!input.current()) return err("Settings target changed");
		const globalText =
			target === "workspace" && globalFile
				? await this.textOf(URI.fromFilePath(globalFile))
				: undefined;
		if (!input.current()) return err("Settings target changed");
		const r = savedLayeredText({
			text: before,
			section,
			target,
			changes,
			globalText,
		});
		if (!r.ok) return r;
		await writeText(this.files, file, before, r.value);
		return r;
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
		this.targetRevision++;
		return this.read(section, target, { kept: this.keptOf(section) });
	}

	/** The scope switch (ADR-095): every form saves to the other target. */
	async retargetAll(target: Target) {
		await Promise.all(SECTIONS.map((s) => this.retarget(s, target)));
	}

	/** The save bar (ADR-095): every changed form saves to its own file, one after the other. */
	async saveAll(current: () => boolean = () => true) {
		const generation = this.generation;
		const targetRevision = this.targetRevision;
		const active = () =>
			current() &&
			generation === this.generation &&
			targetRevision === this.targetRevision;
		for (const s of SECTIONS) {
			if (!active()) return;
			if (this.states.get(s)?.dirty) await this.save(s, active);
		}
	}

	// Reset removes the scalar form keys from this folder; pending edits to other keys survive.
	protected async clear(section: FormSection) {
		const state = this.states.get(section);
		const file = this.fileOf(section, "workspace");
		if (!state || !file || state.busy || !state.readValid) return;
		const token = this.contexts.get(section);
		const current = () => this.current(section, token);
		this.states.set(section, { ...state, busy: true });
		this.onChange();
		const cleared: Draft = Object.fromEntries(
			FORM_FIELDS[section].map((f) => [f.path.join("."), undefined]),
		);
		try {
			const r = await this.edit({
				file,
				section,
				target: "workspace",
				changes: cleared,
				current,
			});
			if (!current()) return;
			if (!r.ok) return this.refused(section, r.error);
			const text = nls.localize(
				"mete/settings/cleared",
				"Cleared in {0}; it applies when METE starts again.",
				file.path.fsPath(),
			);
			const pending = this.keptOf(section);
			const kept =
				state.target === "workspace"
					? Object.fromEntries(
							Object.entries(pending).filter(
								([key]) => !Object.hasOwn(cleared, key),
							),
						)
					: pending;
			await this.read(section, state.target, {
				note: { kind: "saved", text },
				kept,
			});
		} catch (e) {
			if (current()) this.refused(section, String(e));
		}
	}

	protected async read(
		section: FormSection,
		target: Target,
		options: {
			readonly note?: FormState["note"];
			readonly kept?: Draft;
			readonly current?: () => boolean;
		} = {},
	) {
		const { note, kept = {} } = options;
		const token = {};
		this.contexts.set(section, token);
		const previous = this.states.get(section);
		if (previous)
			this.states.set(section, { ...previous, busy: true, readValid: false });
		const file = this.fileOf(section, target);
		const loaded = await this.readValues({
			file,
			section,
			target,
			globalFile: this.globalFile,
		});
		if (!this.current(section, token)) return;
		if (options.current && !options.current())
			return this.release(section, token);
		this.states.set(section, {
			target,
			file: file?.path.fsPath(),
			values: { ...(loaded.ok ? loaded.value.draft : {}), ...kept },
			defaults: loaded.ok ? loaded.value.defaults : defaultsOf(section),
			inherited: loaded.ok ? loaded.value.inherited : {},
			readValid: loaded.ok,
			busy: false,
			dirty: Object.keys(kept).length > 0,
			note: loaded.ok ? note : { kind: "refused", text: loaded.error },
		});
		this.changed.set(section, new Set(Object.keys(kept)));
		this.onChange();
	}

	protected async readValues(input: {
		file: URI | undefined;
		section: FormSection;
		target: Target;
		globalFile: string | undefined;
	}) {
		const { file, section, target, globalFile } = input;
		try {
			const draft = draftOf(
				file ? await this.textOf(file) : undefined,
				section,
				target,
			);
			if (!draft.ok) return draft;
			const globalText =
				section === "policy" && target === "workspace" && globalFile
					? await this.textOf(URI.fromFilePath(globalFile))
					: undefined;
			const defaults = inheritedDefaults(globalText, section);
			if (!defaults.ok) return defaults;
			const inherited = draftOf(globalText, section, "global");
			return inherited.ok
				? ok({
						draft: draft.value,
						defaults: defaults.value,
						inherited: inherited.value,
					})
				: inherited;
		} catch {
			return err(
				nls.localize(
					"mete/settings/readFailed",
					"Settings could not be read. Refresh to retry.",
				),
			);
		}
	}

	protected field(section: FormSection, key: string, value: FieldValue) {
		const state = this.states.get(section);
		if (!state || state.busy) return;
		if (
			!state.readValid &&
			!FORM_FIELDS[section].some((field) => field.path.join(".") === key)
		)
			return;
		this.states.set(section, {
			...state,
			values: { ...state.values, [key]: value },
			dirty: true,
			note: state.readValid ? undefined : state.note,
		});
		this.changed.get(section)?.add(key);
		this.onChange();
	}

	protected async save(
		section: FormSection,
		active: () => boolean = () => true,
	) {
		const state = this.states.get(section);
		const file = state && this.fileOf(section, state.target);
		if (!state || !file || state.busy || !state.readValid || !active()) return;
		const token = this.contexts.get(section);
		const current = () => this.current(section, token) && active();
		this.states.set(section, { ...state, busy: true });
		this.onChange();
		const keys = [...(this.changed.get(section) ?? [])];
		const changes: Draft = Object.fromEntries(
			keys.map((k) => [k, state.values[k]]),
		);
		try {
			const r = await this.edit({
				file,
				section,
				target: state.target,
				changes,
				current,
			});
			if (!current()) return;
			if (!r.ok) return this.refused(section, r.error);
			const text = nls.localize(
				"mete/settings/saved",
				"Saved to {0}; it applies when METE starts again.",
				file.path.fsPath(),
			);
			await this.read(section, state.target, {
				note: { kind: "saved", text },
				current: active,
			});
		} catch (e) {
			reportSaveFailure(current, () => this.refused(section, String(e)));
		} finally {
			if (!active()) this.release(section, token);
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
