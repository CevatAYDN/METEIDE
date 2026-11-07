import {
	err,
	type McpServer,
	ok,
	type RegistryEntry,
	type RegistrySetupResult,
	RegistrySetupResultSchema,
	type Result,
} from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type {
	DaemonFailure,
	RegistryDraft,
	RegistryResults,
} from "../domain/status-service.js";

/** Legacy drafts remain notes-blocked; protocol33 explicitly identifies supported requirements. */
export type CatalogDraft = RegistryDraft | RegistrySetupResult;
/** A structured supported field may be configured after adding; unsupported drafts may not. */
export const catalogBlocked = (draft: CatalogDraft) =>
	"blocked" in draft ? draft.blocked : draft.notes.length > 0;

export type CatalogState = {
	readonly query: string;
	readonly busy: boolean;
	readonly entries?: readonly RegistryEntry[];
	readonly draft?: CatalogDraft | undefined;
	readonly error?: string | undefined;
};

type CatalogDeps = {
	readonly search: (
		query: string,
	) => Promise<Result<RegistryResults, DaemonFailure>>;
	readonly prepare: (
		name: string,
	) => Promise<Result<CatalogDraft, DaemonFailure>>;
	readonly add: (server: McpServer) => boolean;
	readonly onChange: () => void;
};

/** User-triggered reads produce a local draft. Reset invalidates all outstanding requests. */
export class ToolCatalog {
	state: CatalogState = { query: "", busy: false };
	protected request: object = {};

	constructor(protected readonly deps: CatalogDeps) {}

	query(query: string) {
		this.put({ ...this.state, query });
	}
	reset() {
		this.request = {};
		this.put({ query: "", busy: false });
	}

	async search() {
		const query = this.state.query.trim();
		if (!query || this.state.busy) return;
		await this.read(
			() => this.deps.search(query),
			(value) => ({ entries: value.entries, draft: undefined }),
		);
	}

	async prepare(name: string) {
		if (this.state.busy) return;
		await this.read(
			async () => {
				const result = await this.deps.prepare(name);
				if (
					!result.ok ||
					(!("fields" in result.value) && !("blocked" in result.value))
				)
					return result;
				const parsed = RegistrySetupResultSchema.safeParse(result.value);
				return parsed.success
					? ok(parsed.data)
					: err<DaemonFailure>({ code: "protocol", detail: "" });
			},
			(value) => ({ draft: value }),
		);
	}

	add() {
		const draft = this.state.draft;
		if (!draft || this.state.busy) return;
		if (catalogBlocked(draft)) return;
		if (this.deps.add(draft.server))
			this.put({ ...this.state, draft: undefined, error: undefined });
		else
			this.put({
				...this.state,
				error: nls.localize(
					"mete/tools/catalogAddFailed",
					"The draft could not be added. Check for an existing server with this ID.",
				),
			});
	}

	protected async read<T>(
		load: () => Promise<Result<T, DaemonFailure>>,
		patch: (value: T) => Partial<CatalogState>,
	) {
		const request = {};
		this.request = request;
		this.put({ ...this.state, busy: true, error: undefined });
		try {
			const result = await load();
			if (this.request !== request) return;
			this.put({
				...this.state,
				busy: false,
				...(result.ok
					? patch(result.value)
					: {
							error: nls.localize(
								"mete/tools/catalogUnavailable",
								"The catalog could not be reached. Try again.",
							),
						}),
			});
		} catch {
			if (this.request === request)
				this.put({
					...this.state,
					busy: false,
					error: nls.localize(
						"mete/tools/catalogUnavailable",
						"The catalog could not be reached. Try again.",
					),
				});
		}
	}

	protected put(state: CatalogState) {
		this.state = state;
		this.deps.onChange();
	}
}
