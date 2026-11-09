import { DAEMON_METHODS, err, ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import type { SkillManagementService } from "../src/domain/skill-management.js";
import {
	type SkillTransport,
	skillRequests,
} from "../src/infrastructure/skill-requests.js";
import { createSkillSettings } from "../src/infrastructure/skill-settings.js";
import {
	SKILL_PREVIEW,
	SKILL_SESSION,
	skillEntry,
	skillList,
	skillPreview,
} from "./skill-fixture.js";

const setup = () => {
	let notify = () => {};
	let acknowledgement: Promise<unknown> = Promise.resolve({});
	let refuseAdmission = false;
	let active: SkillTransport;
	const calls: { identity: object; method: string; params: object }[] = [];
	const closed = new Set<object>();
	const readReply = (method: string, first: boolean) => {
		if (method === DAEMON_METHODS.skillsPrepare && skillPreview.ok)
			return {
				...skillPreview,
				value: {
					...skillPreview.value,
					expiresAt: "2099-01-01T00:00:00.000Z",
				},
			};
		if (method === DAEMON_METHODS.skillsList && skillList.ok)
			return {
				...skillList,
				value: {
					...skillList.value,
					sessionId: first ? SKILL_SESSION : SKILL_PREVIEW,
				},
			};
		return null;
	};
	const transport = (): SkillTransport => {
		const identity = {};
		const live: SkillTransport = {
			identity,
			current: () => active === live && !closed.has(identity),
			ended: () => closed.has(identity),
			send: async (method, params, parse) => {
				calls.push({ identity, method, params });
				if (method === DAEMON_METHODS.quiesce && refuseAdmission)
					return err({ code: "refused", detail: "Active work" });
				const raw: unknown =
					method === DAEMON_METHODS.skillsApprove
						? await acknowledgement
						: readReply(method, live === original);
				const parsed = parse(raw);
				return parsed.success
					? ok(parsed.data)
					: err({ code: "protocol", detail: "Malformed acknowledgement" });
			},
			retire: vi.fn(async () => {
				closed.add(identity);
			}),
		};
		return live;
	};
	const original = transport();
	active = original;
	const api = skillRequests({
		acquire: async () => {
			if (active.ended()) active = transport();
			return ok(active);
		},
		current: () => active,
	});
	const mount = async (service: SkillManagementService = api) => {
		const settings = createSkillSettings({
			api: service,
			dir: async () => "/w",
			listen: (listener) => {
				notify = listener;
				return {
					dispose: () => {
						notify = () => {};
					},
				};
			},
			changed: () => {},
		});
		await Promise.resolve();
		return settings;
	};
	return {
		api,
		mount,
		calls,
		callsFor: (method: string) =>
			calls.filter((call) => call.method === method),
		original,
		notify: () => notify(),
		methods: () => calls.map((call) => call.method),
		replace: () => {
			active = transport();
			return active;
		},
		close: () => closed.add(original.identity),
		busy: () => {
			refuseAdmission = true;
		},
		pending: () => {
			let resolve!: (raw: unknown) => void;
			acknowledgement = new Promise((yes) => {
				resolve = yes;
			});
			return () => resolve({});
		},
	};
};
const review = (settings: ReturnType<typeof createSkillSettings>) =>
	settings
		.view()
		.onReview(settings.view().state.inventory?.entries[0] ?? skillEntry);

it.each([
	{ reset: "notification", pending: false },
	{ reset: "recreation", pending: false },
	{ reset: "notification", pending: true },
	{ reset: "recreation", pending: true },
])(
	"recovers only explicitly after $reset with pending=$pending",
	async (mode) => {
		const s = setup();
		let settings = await s.mount();
		expect(s.calls).toEqual([]);
		await settings.view().onRefresh();
		await review(settings);
		const retained = settings.view();
		const release = mode.pending ? s.pending() : undefined;
		const mutation = retained.onApprove();
		if (!mode.pending) await mutation;
		if (mode.reset === "notification") {
			s.notify();
			await Promise.resolve();
		} else {
			settings.dispose();
			settings = await s.mount();
		}
		await settings.reconnect();
		await retained.onApprove();
		await retained.onRefresh();
		await retained.onRecover();
		expect(s.methods()).toEqual([
			DAEMON_METHODS.skillsList,
			DAEMON_METHODS.skillsPrepare,
			DAEMON_METHODS.skillsApprove,
		]);
		await settings.view().onRefresh();
		expect(settings.view().state.phase).toBe("recovery");
		expect(settings.view().state.inventory).toBeUndefined();
		expect(settings.view().state.preview).toBeUndefined();
		if (release) {
			await settings.view().onRecover();
			expect(s.original.retire).not.toHaveBeenCalled();
			expect(s.methods()).not.toContain(DAEMON_METHODS.quiesce);
			release();
			await mutation;
		}
		expect(s.methods()).not.toContain(DAEMON_METHODS.quiesce);
		await settings.view().onRecover();
		expect(s.original.retire).toHaveBeenCalledTimes(1);
		expect(s.callsFor(DAEMON_METHODS.quiesce)).toEqual([
			{
				identity: s.original.identity,
				method: DAEMON_METHODS.quiesce,
				params: {},
			},
		]);
		expect(s.callsFor(DAEMON_METHODS.skillsApprove)).toHaveLength(1);
		expect(settings.view().state.phase).toBe("ready");
		expect(settings.view().state.inventory?.sessionId).toBe(SKILL_PREVIEW);
		settings.dispose();
	},
);

it.each(["replacement", "active", "closed"] as const)(
	"keeps recovery exact after controller recreation with %s origin",
	async (mode) => {
		const s = setup();
		let settings = await s.mount();
		await settings.view().onRefresh();
		await review(settings);
		await settings.view().onApprove();
		settings.dispose();
		const replacement = mode !== "active" ? s.replace() : undefined;
		if (mode === "closed") s.close();
		if (mode === "active") s.busy();
		settings = await s.mount();
		await settings.view().onRefresh();
		expect(settings.view().state.phase).toBe("recovery");
		expect(s.methods()).not.toContain(DAEMON_METHODS.quiesce);
		await settings.view().onRecover();
		if (replacement) expect(replacement.retire).not.toHaveBeenCalled();
		expect(s.original.retire).toHaveBeenCalledTimes(mode === "closed" ? 1 : 0);
		expect(settings.view().state.phase).toBe(
			mode === "closed" ? "ready" : "recovery",
		);
		expect(s.callsFor(DAEMON_METHODS.quiesce)).toHaveLength(
			mode === "active" ? 1 : 0,
		);
		expect(s.callsFor(DAEMON_METHODS.skillsApprove)).toHaveLength(1);
		settings.dispose();
	},
);

it("rejects malformed recovery identity at the renderer without quiescing", async () => {
	const s = setup();
	let settings = await s.mount();
	await settings.view().onRefresh();
	await review(settings);
	await settings.view().onApprove();
	settings.dispose();
	settings = await s.mount({ ...s.api, skillsRecovery: async () => ok("bad") });
	await settings.view().onRefresh();
	expect(settings.view().state.phase).toBe("error");
	await settings.view().onRecover();
	expect(s.methods()).not.toContain(DAEMON_METHODS.quiesce);
	expect(s.original.retire).not.toHaveBeenCalled();
	settings.dispose();
});
