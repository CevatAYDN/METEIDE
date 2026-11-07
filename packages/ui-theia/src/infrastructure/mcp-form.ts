import { err, McpConfigSchema, ok, type Result } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { z } from "zod";
import type { McpActions, McpState } from "../application/mcp-card.js";
import {
	EMPTY_MCP_SERVER,
	type McpDraft,
	type McpServerDraft,
	serverDraftOf,
	serversOf,
	serversText,
} from "../application/mcp-draft.js";
import type { Target } from "../application/section-draft.js";
import type { SaveNote } from "../application/settings-form.js";
import { textOf, writeText } from "./settings-forms.js";

// The MCP servers card's file (ADR-097), read and written through Theia's file service on the user's
// click only (ADR-072). This folder's .mete/mcp.yaml is the default, as ADR-082's forms; the other
// target is the mcp key of the global settings.yaml.

export class McpForm {
	protected state: McpState | undefined;
	protected root: URI | undefined;
	protected globalFile: string | undefined;
	protected revision = 0;

	constructor(
		protected readonly files: FileService,
		protected readonly onChange: () => void,
	) {}

	/** Reads the card's file again, for the open folder and the global settings file. */
	async load(root: URI | undefined, globalFile: string | undefined) {
		const target = this.state?.target ?? "workspace";
		if (
			this.root?.toString() !== root?.toString() ||
			this.globalFile !== globalFile
		)
			this.state = undefined;
		const typed = this.state?.dirty ? this.state.servers : undefined;
		this.root = root;
		this.globalFile = globalFile;
		await this.read(target, undefined, typed);
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
				onAdd: () => this.edit((servers) => [...servers, EMPTY_MCP_SERVER]),
				onAddDraft: (drafts) => this.acceptDraft(drafts),
				onRemove: (i) =>
					this.edit((servers) => servers.filter((_, at) => at !== i)),
			},
		};
	}

	/** Atomically adds guided rows or one validated catalog server; it neither saves nor connects. */
	addDraft(input: unknown): boolean {
		return this.acceptDraft(input).ok;
	}

	protected acceptDraft(input: unknown): Result<McpDraft, string> {
		const state = this.state;
		if (!state || state.busy || state.unread)
			return err(
				nls.localize(
					"mete/tools/formUnavailable",
					"Wait for the tool list to finish loading.",
				),
			);
		const rows = Array.isArray(input) ? input : [input];
		const native = McpConfigSchema.safeParse({ servers: rows });
		if (
			native.success &&
			native.data.servers.some(
				(server) =>
					server.transport === "stdio" &&
					server.args.some((arg) => arg === "" || /[\r\n]/.test(arg)),
			)
		)
			return err(
				nls.localize(
					"mete/tools/argsInvalid",
					"Each argument must be a non-empty single line. Use advanced setup for other values.",
				),
			);
		const checked = native.success
			? ok(rows.map(serverDraftOf))
			: draftList(rows);
		if (!checked.ok) return checked;
		const combined = [...state.servers, ...checked.value];
		const valid = serversText(undefined, "workspace", combined);
		if (!valid.ok) return err(valid.error);
		this.state = {
			...state,
			servers: combined,
			prepared: checked.value.at(-1),
			dirty: true,
			note: undefined,
		};
		this.onChange();
		return ok(checked.value);
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
	async save(): Promise<boolean> {
		const state = this.state;
		const file = state && this.fileOf(state.target);
		if (!state || !file || state.busy || state.unread) return false;
		let revision = this.revision;
		this.state = { ...state, busy: true };
		this.onChange();
		try {
			const before = await textOf(this.files, file);
			if (revision !== this.revision) return false;
			const r = serversText(before, state.target, state.servers);
			if (!r.ok) {
				this.refused(r.error);
				return false;
			}
			await writeText(this.files, file, before, r.value);
			if (revision !== this.revision) return false;
			const text = nls.localize(
				"mete/settings/saved",
				"Saved to {0}; it applies when METE starts again.",
				file.path.fsPath(),
			);
			revision += 1;
			return await this.read(state.target, { kind: "saved", text });
		} catch (e) {
			if (revision === this.revision) this.refused(String(e));
			return false;
		}
	}

	protected async read(target: Target, note?: SaveNote, typed?: McpDraft) {
		const revision = ++this.revision;
		const file = this.fileOf(target);
		if (this.state) {
			this.state = {
				...this.state,
				target,
				file: file?.path.fsPath(),
				busy: true,
				loading: true,
			};
			this.onChange();
		}
		let source: string | undefined;
		try {
			source = file ? await textOf(this.files, file) : undefined;
		} catch (error) {
			if (revision !== this.revision) return false;
			this.loadRefused(target, typed, error);
			return false;
		}
		const listed = serversOf(source, target);
		if (revision !== this.revision) return false;
		this.state = {
			target,
			file: file?.path.fsPath(),
			servers: typed ?? (listed.ok ? listed.value : []),
			busy: false,
			unread: !listed.ok,
			dirty: typed !== undefined,
			note: listed.ok ? note : { kind: "refused", text: listed.error },
			prepared: typed ? this.state?.prepared : undefined,
		};
		this.onChange();
		return listed.ok;
	}

	protected loadRefused(
		target: Target,
		typed: McpDraft | undefined,
		error: unknown,
	) {
		this.state = {
			...this.state,
			target,
			file: this.fileOf(target)?.path.fsPath(),
			servers: typed ?? [],
			prepared: typed ? this.state?.prepared : undefined,
			busy: false,
			loading: false,
			unread: true,
			dirty: typed !== undefined,
			note: {
				kind: "refused",
				text: nls.localize(
					"mete/tools/readFailed",
					"Could not load tools: {0}. Retry Refresh.",
					String(error),
				),
			},
		};
		this.onChange();
	}

	protected edit(change: (servers: McpDraft) => McpDraft) {
		if (!this.state || this.state.busy || this.state.unread) return;
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
			loading: false,
			note: { kind: "refused", text },
		};
		this.onChange();
	}
}

// Drafts are internal UI input, but catalog objects still cross the public contract boundary.
const draftList = (input: unknown[]): Result<McpDraft, string> => {
	const parsed = z
		.array(
			z.strictObject({
				id: z.string(),
				transport: z.string(),
				runtime: z.string(),
				command: z.string(),
				args: z.string(),
				env: z.string(),
				url: z.string(),
				sha256: z.string(),
				auth: z.string(),
				permissions: z.array(z.string()),
			}),
		)
		.min(1)
		.safeParse(input);
	if (!parsed.success)
		return err(
			nls.localize(
				"mete/tools/draftInvalid",
				"The tool draft is invalid. Review its required fields.",
			),
		);
	const checked = serversText(undefined, "workspace", parsed.data);
	return checked.ok ? ok(parsed.data) : err(checked.error);
};

// A box ticked adds its permission at the end; unticked, it goes.
const withPermission = (
	server: McpServerDraft,
	permission: string,
	on: boolean,
) =>
	on
		? [...server.permissions, permission]
		: server.permissions.filter((p) => p !== permission);
