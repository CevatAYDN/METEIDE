import {
	DAEMON_METHODS,
	DaemonDoneResultSchema,
	type DaemonSkillsApproveParams,
	DaemonSkillsApproveParamsSchema,
	DaemonSkillsApproveResultSchema,
	type DaemonSkillsDisableParams,
	DaemonSkillsDisableParamsSchema,
	DaemonSkillsDisableResultSchema,
	type DaemonSkillsEditorParams,
	DaemonSkillsEditorParamsSchema,
	DaemonSkillsEditorResultSchema,
	DaemonSkillsListResultSchema,
	type DaemonSkillsPrepareParams,
	DaemonSkillsPrepareParamsSchema,
	DaemonSkillsPrepareResultSchema,
	err,
	IdSchema,
	ok,
	type Result,
} from "@mete/contracts";
import type { DaemonFailure } from "../domain/daemon-failure.js";
import type { SkillManagementService } from "../domain/skill-management.js";
import type { Parsed } from "./settings-requests.js";

/** A captured process, not a lookup of the host's mutable slot at completion. */
export type SkillTransport = {
	readonly identity: object;
	readonly current: () => boolean;
	readonly ended: () => boolean;
	readonly send: <T>(
		method: string,
		params: object,
		parse: (raw: unknown) => Parsed<T>,
	) => Promise<Result<T, DaemonFailure>>;
	readonly retire: () => Promise<void>;
};
type Deps = {
	readonly acquire: (
		dir: string,
	) => Promise<Result<SkillTransport, DaemonFailure>>;
	readonly current: (dir: string) => SkillTransport | undefined;
};
type Origin = {
	dir: string;
	sessionId: string;
	transport: SkillTransport;
	uncertain: boolean;
	pending: boolean;
};
const stale = () =>
	err({
		code: "stopped" as const,
		detail: "The skill session changed; discover again",
	});
const invalid = () =>
	err({
		code: "protocol" as const,
		detail: "The skill response is uncertain; recover before continuing",
	});

class SkillRequests implements SkillManagementService {
	private readonly origins = new Map<string, Origin>();
	constructor(private readonly deps: Deps) {}

	private capture(dir: string, sessionId: string) {
		const live = this.deps.current(dir);
		const origin = this.origins.get(dir);
		return origin?.dir === dir &&
			origin.sessionId === sessionId &&
			live?.identity === origin.transport.identity &&
			live.current()
			? origin
			: undefined;
	}
	private async mutate<T extends { admitted: boolean }>(
		from: Origin,
		method: string,
		params: object,
		parse: (raw: unknown) => Parsed<T>,
	): Promise<Result<T, DaemonFailure>> {
		if (from.uncertain) return invalid();
		// Concurrent mutations cannot consume the same preview or bypass recovery.
		from.uncertain = true;
		from.pending = true;
		let result: Result<T, DaemonFailure>;
		try {
			result = await from.transport.send(method, params, parse);
		} catch {
			result = invalid();
		}
		from.pending = false;
		if (result.ok) {
			if (result.value.admitted) await from.transport.retire();
			from.uncertain = false;
		}
		return result;
	}
	async skillsList(dir: string) {
		if (this.origins.get(dir)?.uncertain) return invalid();
		const live = await this.deps.acquire(dir);
		if (!live.ok) return live;
		const result = await live.value.send(DAEMON_METHODS.skillsList, {}, (raw) =>
			DaemonSkillsListResultSchema.safeParse(raw),
		);
		if (!live.value.current()) return stale();
		if (this.origins.get(dir)?.uncertain) return invalid();
		if (result.ok && result.value.ok)
			this.origins.set(dir, {
				dir,
				sessionId: result.value.value.sessionId,
				transport: live.value,
				uncertain: false,
				pending: false,
			});
		return result;
	}
	async skillsPrepare(dir: string, input: DaemonSkillsPrepareParams) {
		const parsed = DaemonSkillsPrepareParamsSchema.safeParse(input);
		if (!parsed.success) return invalid();
		const from = this.capture(dir, parsed.data.sessionId);
		if (!from) return stale();
		if (from.uncertain) return invalid();
		const result = await from.transport.send(
			DAEMON_METHODS.skillsPrepare,
			parsed.data,
			(raw) => DaemonSkillsPrepareResultSchema.safeParse(raw),
		);
		if (!from.transport.current()) return stale();
		if (
			result.ok &&
			result.value.ok &&
			(result.value.value.sessionId !== from.sessionId ||
				result.value.value.inspection.source.sourceId !== parsed.data.sourceId)
		)
			return invalid();
		return result;
	}
	async skillsEditor(dir: string, input: DaemonSkillsEditorParams) {
		const parsed = DaemonSkillsEditorParamsSchema.safeParse(input);
		if (!parsed.success) return invalid();
		const from = this.capture(dir, parsed.data.sessionId);
		if (!from) return stale();
		if (from.uncertain) return invalid();
		const result = await from.transport.send(
			DAEMON_METHODS.skillsEditor,
			parsed.data,
			(raw) => DaemonSkillsEditorResultSchema.safeParse(raw),
		);
		if (!from.transport.current()) return stale();
		if (
			result.ok &&
			result.value.ok &&
			(result.value.value.sessionId !== from.sessionId ||
				result.value.value.source.sourceId !== parsed.data.sourceId)
		)
			return invalid();
		return result;
	}
	async skillsApprove(dir: string, input: DaemonSkillsApproveParams) {
		const parsed = DaemonSkillsApproveParamsSchema.safeParse(input);
		if (!parsed.success) return invalid();
		const from = this.capture(dir, parsed.data.sessionId);
		return from
			? this.mutate(from, DAEMON_METHODS.skillsApprove, parsed.data, (raw) =>
					DaemonSkillsApproveResultSchema.safeParse(raw),
				)
			: stale();
	}
	async skillsDisable(dir: string, input: DaemonSkillsDisableParams) {
		const parsed = DaemonSkillsDisableParamsSchema.safeParse(input);
		if (!parsed.success) return invalid();
		const from = this.capture(dir, parsed.data.sessionId);
		return from
			? this.mutate(from, DAEMON_METHODS.skillsDisable, parsed.data, (raw) =>
					DaemonSkillsDisableResultSchema.safeParse(raw),
				)
			: stale();
	}
	async skillsRecovery(dir: string) {
		const from = this.origins.get(dir);
		return ok(from?.dir === dir && from.uncertain ? from.sessionId : null);
	}
	async skillsRecover(dir: string, sessionId: string) {
		if (!IdSchema.safeParse(sessionId).success) return invalid();
		const from = this.origins.get(dir);
		if (!from || from.dir !== dir || from.sessionId !== sessionId)
			return stale();
		if (from.pending) return invalid();
		// Closed origins need no current slot or quiesce; replacements stay untouched.
		if (from.transport.ended()) {
			await from.transport.retire();
			from.uncertain = false;
			return ok(null);
		}
		if (!this.capture(dir, sessionId)) return stale();
		const result = await from.transport.send(
			DAEMON_METHODS.quiesce,
			{},
			(raw) => DaemonDoneResultSchema.safeParse(raw),
		);
		if (result.ok) {
			await from.transport.retire();
			from.uncertain = false;
		}
		return result;
	}
}

/** No ensure/restart/replay for session-bound review, editing or mutations. */
export const skillRequests = (deps: Deps): SkillManagementService => {
	const requests = new SkillRequests(deps);
	return {
		skillsList: requests.skillsList.bind(requests),
		skillsPrepare: requests.skillsPrepare.bind(requests),
		skillsEditor: requests.skillsEditor.bind(requests),
		skillsApprove: requests.skillsApprove.bind(requests),
		skillsDisable: requests.skillsDisable.bind(requests),
		skillsRecovery: requests.skillsRecovery.bind(requests),
		skillsRecover: requests.skillsRecover.bind(requests),
	};
};
