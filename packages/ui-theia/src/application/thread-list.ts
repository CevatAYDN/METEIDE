import {
	type ConversationThread,
	err,
	type ThreadCursor,
} from "@mete/contracts";
import type {
	DaemonFailure,
	MeteDaemonService,
} from "../domain/status-service.js";

/** A failed metadata read is distinct from a genuinely empty local search (ADR-182). */
export type ThreadListState = {
	readonly kind: "loading" | "ready" | "failed" | "no_folder";
	readonly query: string;
	readonly rows: readonly ConversationThread[];
	readonly cursor?: ThreadCursor | undefined;
	readonly failure?: DaemonFailure | undefined;
};

type Deps = {
	readonly fetch: MeteDaemonService["threadList"];
	readonly onChange: () => void;
};

/** Owns one workspace's paged conversation list and in-flight read generation. */
export class ThreadList {
	private dir: string | undefined;
	private generation = 0;
	private appendFailed = false;
	state: ThreadListState = { kind: "loading", query: "", rows: [] };
	constructor(private readonly deps: Deps) {}
	private set(next: ThreadListState) {
		this.state = next;
		this.deps.onChange();
	}
	private async read(target: string, cursor: ThreadCursor | undefined) {
		try {
			return await this.deps.fetch(target, {
				query: this.state.query.trim(),
				...(cursor ? { cursor } : {}),
			});
		} catch {
			return err({ code: "stopped" as const, detail: "" });
		}
	}
	private async load(append = false): Promise<void> {
		if (!this.dir) return;
		const target = this.dir;
		const asked = ++this.generation;
		const cursor = append ? this.state.cursor : undefined;
		const query = this.state.query;
		this.appendFailed = append;
		this.set({ ...this.state, kind: "loading", failure: undefined });
		const result = await this.read(target, cursor);
		if (asked !== this.generation || this.dir !== target) return;
		if (!result.ok)
			return this.set({ ...this.state, kind: "failed", failure: result.error });
		const rows = append
			? [...this.state.rows, ...result.value.conversations]
			: result.value.conversations;
		this.set({
			kind: "ready",
			query,
			rows: [...new Map(rows.map((row) => [row.id, row])).values()],
			cursor: result.value.nextCursor,
		});
	}
	show(folder: string) {
		if (this.dir !== folder) this.set({ kind: "loading", query: "", rows: [] });
		this.dir = folder;
		return this.load();
	}
	search(query: string) {
		this.set({ kind: "loading", query, rows: [] });
		return this.load();
	}
	refresh() {
		return this.load();
	}
	more() {
		return this.state.kind === "ready" && this.state.cursor
			? this.load(true)
			: Promise.resolve();
	}
	retry() {
		return this.load(this.appendFailed);
	}
	clear() {
		this.dir = undefined;
		this.generation++;
		this.set({ kind: "no_folder", query: "", rows: [] });
	}
}

/** Local daemon search with stable paging; new searches and folders invalidate late answers. */
export const createThreadList = (deps: Deps) => new ThreadList(deps);
