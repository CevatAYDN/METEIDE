import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import type { McpActions, McpState } from "../application/mcp-card.js";
import {
	type McpDraft,
	type McpServerDraft,
	serversOf,
	serversText,
} from "../application/mcp-draft.js";
import type { Target } from "../application/section-draft.js";
import type { SaveNote } from "../application/settings-form.js";
import { textOf, writeText } from "./settings-forms.js";

// The MCP servers card's file (ADR-097), read and written through Theia's file service on the user's
// click only (ADR-072). This folder's .mete/mcp.yaml is the default, as ADR-082's forms; the other
// target is the mcp key of the global settings.yaml.

const EMPTY: McpServerDraft = {
	id: "",
	transport: "",
	runtime: "",
	command: "",
	args: "",
	env: "",
	url: "",
	sha256: "",
	auth: "",
	permissions: [],
};

export class McpForm {
	protected state: McpState | undefined;
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
	form(): { state: McpState; actions: McpActions } | undefined {
		if (!this.state) return undefined;
		return {
			state: this.state,
			actions: {
				onField: (i, key, value) =>
					this.edit((servers) =>
						servers.map((server, at) =>
							at === i ? { ...server, [key]: value } : server,
						),
					),
				onPermission: (i, permission, on) =>
					this.edit((servers) =>
						servers.map((server, at) =>
							at === i
								? {
										...server,
										permissions: withPermission(server, permission, on),
									}
								: server,
						),
					),
				onAdd: () => this.edit((servers) => [...servers, EMPTY]),
				onRemove: (i) =>
					this.edit((servers) => servers.filter((_, at) => at !== i)),
			},
		};
	}

	protected fileOf(target: Target) {
		if (target === "global")
			return this.globalFile ? URI.fromFilePath(this.globalFile) : undefined;
		return this.root?.resolve(".mete/mcp.yaml");
	}

	/** The scope switch (ADR-095): the card shows the other target, keeping what was typed. */
	async retarget(target: Target) {
		const typed = this.state?.dirty ? this.state.servers : undefined;
		await this.read(target, undefined, typed);
	}

	/** The save bar (ADR-095): writes the servers, or removes them from the file when it has none. */
	async save() {
		const state = this.state;
		const file = state && this.fileOf(state.target);
		if (!state || !file || state.busy) return;
		this.state = { ...state, busy: true };
		this.onChange();
		try {
			const before = await textOf(this.files, file);
			const r = serversText(before, state.target, state.servers);
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

	protected async read(target: Target, note?: SaveNote, typed?: McpDraft) {
		const file = this.fileOf(target);
		const listed = serversOf(
			file ? await textOf(this.files, file) : undefined,
			target,
		);
		this.state = {
			target,
			file: file?.path.fsPath(),
			servers: typed ?? (listed.ok ? listed.value : []),
			busy: false,
			dirty: typed !== undefined,
			note: listed.ok ? note : { kind: "refused", text: listed.error },
		};
		this.onChange();
	}

	protected edit(change: (servers: McpDraft) => McpDraft) {
		if (!this.state) return;
		this.state = {
			...this.state,
			servers: change(this.state.servers),
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

// A box ticked adds its permission at the end; unticked, it goes.
const withPermission = (
	server: McpServerDraft,
	permission: string,
	on: boolean,
) =>
	on
		? [...server.permissions, permission]
		: server.permissions.filter((p) => p !== permission);
