import {
	DaemonSkillsApproveResultSchema,
	DaemonSkillsListResultSchema,
	DaemonSkillsPrepareResultSchema,
	err,
	IdSchema,
	type Result,
	type SkillError,
	type SkillSourceDescriptor,
	type SkillTrustEntry,
} from "@mete/contracts";
import { z } from "zod";
import type { SkillManagementService } from "../domain/skill-management.js";
import { editorSkillSource } from "./skill-editor-source.js";
import { receiveSkillResponse as receive } from "./skill-response.js";
import {
	canDisableSkill,
	canEditSkill,
	type SkillIssue,
	type SkillState,
	type SkillsViewModel,
} from "./skill-state.js";

export {
	canDisableSkill,
	canEditSkill,
	type SkillIssue,
	type SkillState,
	type SkillsViewModel,
} from "./skill-state.js";

type Deps = {
	readonly api: SkillManagementService;
	readonly changed: () => void;
	readonly now: () => number;
	readonly open?: (
		source: SkillSourceDescriptor,
		current: () => boolean,
		dir: string,
	) => Promise<Result<null, SkillError>>;
};
type Origin = {
	dir: string | undefined;
	generation: number;
	sessionId: string | undefined;
	recoverySessionId: string | undefined;
};

const editIssue = (
	current: boolean,
	opened: Result<null, SkillError>,
): SkillIssue | undefined =>
	!current ? { code: "stale" } : opened.ok ? undefined : opened.error;

/** Explicit management only; changing roots never scans or activates a skill. */
export class SkillSession {
	private dir: string | undefined;
	private generation = 0;
	private recoverySessionId: string | undefined;
	private sourceRefreshPending = false;
	private editorEpoch = 0;
	private value: SkillState = { phase: "idle", busy: false };
	constructor(private readonly deps: Deps) {}

	get state(): SkillState {
		return this.value;
	}
	private set(value: SkillState): void {
		this.value = value;
		this.deps.changed();
	}
	workspace(dir: string | undefined): void {
		this.editorEpoch++;
		this.sourceRefreshPending = false;
		this.dir = dir;
		this.generation++;
		this.recoverySessionId = undefined;
		this.set({ phase: "idle", busy: false });
	}
	/** Re-read only previously requested inventory; never initiate startup discovery. */
	async reconnect(): Promise<void> {
		this.editorEpoch++;
		if (this.value.phase === "idle") return;
		if (this.value.busy) {
			this.sourceRefreshPending = true;
			this.set({ ...this.value, preview: undefined });
			return;
		}
		await this.discover();
	}
	/** A saved source invalidates its preview immediately, including while a request is pending. */
	async sourceChanged(): Promise<void> {
		if (this.value.phase === "idle") return;
		this.sourceRefreshPending = true;
		this.set({ ...this.value, preview: undefined });
		if (!this.value.busy) await this.discover();
	}
	private async finish(value: SkillState): Promise<void> {
		this.set(value);
		if (this.sourceRefreshPending && !value.busy) await this.discover();
	}
	private origin(): Origin {
		return {
			dir: this.dir,
			generation: this.generation,
			sessionId: this.value.inventory?.sessionId,
			recoverySessionId: this.recoverySessionId,
		};
	}
	private current(from: Origin): boolean {
		return (
			this.dir === from.dir &&
			this.generation === from.generation &&
			this.recoverySessionId === from.recoverySessionId &&
			this.value.inventory?.sessionId === from.sessionId
		);
	}
	private ready(from: Origin): boolean {
		return (
			this.current(from) &&
			from.dir !== undefined &&
			from.sessionId !== undefined &&
			this.value.phase === "ready" &&
			!this.value.busy
		);
	}
	private available(from: Origin): boolean {
		return this.ready(from) && this.value.inventory?.complete === true;
	}
	private listed(entry: SkillTrustEntry): boolean {
		return this.value.inventory?.entries.includes(entry) === true;
	}
	private async discover(): Promise<void> {
		const dir = this.dir;
		if (!dir || this.value.busy || this.value.phase === "recovery") return;
		this.sourceRefreshPending = false;
		const generation = ++this.generation;
		this.set({
			...this.value,
			phase: "loading",
			preview: undefined,
			error: undefined,
		});
		const result = await receive(
			this.deps.api.skillsList(dir),
			DaemonSkillsListResultSchema,
		);
		if (this.dir !== dir || this.generation !== generation) return;
		if (!result.ok) return this.failedDiscovery(dir, generation);
		if (!result.value.ok)
			return this.set({
				...this.value,
				phase: "error",
				error: result.value.error,
			});
		this.set({ phase: "ready", busy: false, inventory: result.value.value });
	}
	private async failedDiscovery(
		dir: string,
		generation: number,
	): Promise<void> {
		const result = await receive(
			this.deps.api.skillsRecovery(dir),
			IdSchema.nullable(),
		);
		if (this.dir !== dir || this.generation !== generation) return;
		this.recoverySessionId = result.ok
			? (result.value ?? undefined)
			: undefined;
		this.set({
			...this.value,
			phase: this.recoverySessionId ? "recovery" : "error",
			error: { code: "transport" },
		});
	}
	private async review(from: Origin, entry: SkillTrustEntry): Promise<void> {
		if (
			!this.available(from) ||
			!this.listed(entry) ||
			!entry.metadata ||
			["invalid", "missing", "unavailable"].includes(entry.status)
		)
			return;
		this.set({
			...this.value,
			busy: true,
			preview: undefined,
			error: undefined,
		});
		const result = await receive(
			this.deps.api.skillsPrepare(from.dir ?? "", {
				sessionId: from.sessionId ?? "",
				sourceId: entry.source.sourceId,
			}),
			DaemonSkillsPrepareResultSchema,
		);
		if (!this.current(from)) return;
		if (!result.ok)
			return this.finish({
				...this.value,
				busy: false,
				error: { code: "transport" },
			});
		if (!result.value.ok)
			return this.finish({
				...this.value,
				busy: false,
				error: result.value.error,
			});
		const preview = result.value.value;
		if (
			preview.sessionId !== from.sessionId ||
			preview.inspection.source.sourceId !== entry.source.sourceId
		)
			return this.finish({
				...this.value,
				busy: false,
				error: { code: "stale" },
			});
		await this.finish({ ...this.value, busy: false, preview });
	}
	private async discoverWithIssue(
		from: Origin,
		issue: SkillState["error"],
	): Promise<void> {
		await this.discover();
		if (
			this.dir === from.dir &&
			this.generation === from.generation + 1 &&
			issue
		)
			this.set({ ...this.value, error: this.value.error ?? issue });
	}
	private async settleEdit(from: Origin, error?: SkillIssue): Promise<void> {
		if (!this.current(from)) return;
		this.set({
			...this.value,
			busy: false,
			preview: undefined,
			phase: error ? "error" : "ready",
			error,
		});
		if (this.sourceRefreshPending) await this.discoverWithIssue(from, error);
	}
	private async edit(from: Origin, entry: SkillTrustEntry): Promise<void> {
		const open = this.deps.open;
		if (
			!open ||
			!this.available(from) ||
			!this.listed(entry) ||
			!canEditSkill(entry)
		)
			return;
		const epoch = this.editorEpoch;
		const current = () => this.current(from) && epoch === this.editorEpoch;
		this.set({
			...this.value,
			busy: true,
			preview: undefined,
			error: undefined,
		});
		const source = await editorSkillSource(this.deps.api, {
			dir: from.dir ?? "",
			sessionId: from.sessionId ?? "",
			sourceId: entry.source.sourceId,
			scope: entry.source.scope,
		});
		if (!current()) return this.settleEdit(from, { code: "stale" });
		if (!source.ok) return this.settleEdit(from, source.error);
		const opened = await open(source.value, current, from.dir ?? "").catch(() =>
			err({ code: "unavailable" as const }),
		);
		if (!this.current(from)) return;
		this.sourceRefreshPending = true;
		await this.settleEdit(from, editIssue(current(), opened));
	}
	private async approve(from: Origin): Promise<void> {
		const preview = this.value.preview;
		if (!this.available(from) || !preview) return;
		if (this.deps.now() >= Date.parse(preview.expiresAt))
			return this.set({
				...this.value,
				preview: undefined,
				error: { code: "expired" },
			});
		await this.mutate(from, () =>
			this.deps.api.skillsApprove(from.dir ?? "", {
				sessionId: preview.sessionId,
				previewId: preview.previewId,
			}),
		);
	}
	private async disable(from: Origin, entry: SkillTrustEntry): Promise<void> {
		if (!this.ready(from) || !this.listed(entry) || !canDisableSkill(entry))
			return;
		await this.mutate(from, () =>
			this.deps.api.skillsDisable(from.dir ?? "", {
				sessionId: from.sessionId ?? "",
				sourceId: entry.source.sourceId,
				expectedRevision: entry.revision,
			}),
		);
	}
	private async mutate(
		from: Origin,
		call: () => ReturnType<SkillManagementService["skillsApprove"]>,
	): Promise<void> {
		this.set({
			...this.value,
			busy: true,
			preview: undefined,
			error: undefined,
		});
		const result = await receive(call(), DaemonSkillsApproveResultSchema);
		if (!this.current(from)) return;
		if (!result.ok) {
			this.recoverySessionId = from.sessionId;
			return this.set({
				...this.value,
				busy: false,
				phase: "recovery",
				error: { code: "transport" },
			});
		}
		const issue = result.value.result.ok
			? undefined
			: result.value.result.error;
		this.set({ ...this.value, busy: false, error: issue });
		if (result.value.admitted || this.sourceRefreshPending)
			await this.discoverWithIssue(from, issue);
	}
	private async recover(from: Origin): Promise<void> {
		const sessionId = from.recoverySessionId ?? from.sessionId;
		if (
			!this.current(from) ||
			!from.dir ||
			!sessionId ||
			this.value.busy ||
			this.value.phase !== "recovery"
		)
			return;
		this.set({ ...this.value, busy: true });
		const result = await receive(
			this.deps.api.skillsRecover(from.dir, sessionId),
			z.null(),
		);
		if (!this.current(from)) return;
		if (result.ok) this.recoverySessionId = undefined;
		this.set({
			...this.value,
			busy: false,
			phase: result.ok ? "ready" : "recovery",
		});
		if (result.ok) await this.discover();
	}
	view(): SkillsViewModel {
		const from = this.origin();
		const preview = this.value.preview;
		return {
			state: this.value,
			onRefresh: async () => {
				if (this.current(from)) await this.discover();
			},
			onReview: (entry) => this.review(from, entry),
			onApprove: async () => {
				if (this.value.preview === preview) await this.approve(from);
			},
			onDisable: (entry) => this.disable(from, entry),
			onDismiss: () => {
				if (
					this.current(from) &&
					this.value.preview === preview &&
					!this.value.busy
				)
					this.set({ ...this.value, preview: undefined });
			},
			onRecover: () => this.recover(from),
			...(this.deps.open
				? { onEdit: (entry: SkillTrustEntry) => this.edit(from, entry) }
				: {}),
		};
	}
}
