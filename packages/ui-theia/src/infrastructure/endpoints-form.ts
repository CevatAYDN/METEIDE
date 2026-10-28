import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import type {
	EndpointsActions,
	EndpointsState,
} from "../application/endpoints-card.js";
import {
	type EndpointDraft,
	endpointsOf,
	savedEndpointsText,
} from "../application/endpoints-draft.js";
import type { Target } from "../application/section-draft.js";
import { textOf } from "./settings-forms.js";

// The custom endpoints card's file (ADR-087), read and written through Theia's file service on the
// user's click only (ADR-072). The default target is the global settings.yaml. Another target takes
// the list the user typed with it, or, when nothing was typed, that file's own list.

const EMPTY: EndpointDraft = {
	slug: "",
	name: "",
	baseUrl: "",
	format: "",
	headers: "",
};

export class EndpointsForm {
	protected state: EndpointsState | undefined;
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
		await this.read(this.state?.target ?? "global");
	}

	/** The card's state and actions, for the view. */
	form(): { state: EndpointsState; actions: EndpointsActions } | undefined {
		if (!this.state) return undefined;
		return {
			state: this.state,
			actions: {
				onEdit: (i, field, value) =>
					this.edit((list) =>
						list.map((e, at) => (at === i ? { ...e, [field]: value } : e)),
					),
				onAdd: () => this.edit((list) => [...list, EMPTY]),
				onRemove: (i) => this.edit((list) => list.filter((_, at) => at !== i)),
				onTarget: (target) => void this.retarget(target),
				onSave: () => void this.save(),
			},
		};
	}

	protected fileOf(target: Target) {
		if (target === "global")
			return this.globalFile ? URI.fromFilePath(this.globalFile) : undefined;
		return this.root?.resolve(".mete/providers.yaml");
	}

	protected retarget(target: Target) {
		const typed = this.state?.dirty ? this.state.list : undefined;
		return this.read(target, undefined, typed);
	}

	protected async read(
		target: Target,
		note?: EndpointsState["note"],
		typed?: readonly EndpointDraft[],
	) {
		const file = this.fileOf(target);
		const listed = endpointsOf(
			file ? await textOf(this.files, file) : undefined,
			target,
		);
		this.state = {
			target,
			file: file?.path.fsPath(),
			list: typed ?? (listed.ok ? listed.value : []),
			busy: false,
			dirty: typed !== undefined,
			note: listed.ok ? note : { kind: "refused", text: listed.error },
		};
		this.onChange();
	}

	protected edit(
		change: (list: readonly EndpointDraft[]) => readonly EndpointDraft[],
	) {
		if (!this.state) return;
		const list = change(this.state.list);
		this.state = { ...this.state, list, dirty: true, note: undefined };
		this.onChange();
	}

	/** The card's Save and the save bar (ADR-095): writes the list to the card's own target. */
	async save() {
		const state = this.state;
		const file = state && this.fileOf(state.target);
		if (!state || !file || state.busy) return;
		this.state = { ...state, busy: true };
		this.onChange();
		// provider-custom skips an endpoint without its key, so a restart alone does not bring it in.
		try {
			const r = savedEndpointsText(
				await textOf(this.files, file),
				state.target,
				state.list,
			);
			if (!r.ok) return this.refused(r.error);
			await this.files.write(file, r.value);
			const text = nls.localize(
				"mete/settings/endpointSaved",
				"Saved to {0}; set its API key, or press Apply now if it has one.",
				file.path.fsPath(),
			);
			await this.read(state.target, { kind: "saved", text });
		} catch (e) {
			this.refused(String(e));
		}
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
