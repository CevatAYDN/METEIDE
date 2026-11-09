import { DAEMON_METHODS, err, ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import {
	type SkillTransport,
	skillRequests,
} from "../src/infrastructure/skill-requests.js";
import {
	SKILL_SESSION,
	SKILL_SOURCE,
	skillEntry,
	skillList,
} from "./skill-fixture.js";

const setup = () => {
	let raw: unknown = skillList;
	let live = true;
	let beforeReply = () => {};
	const sent: { method: string; params: object }[] = [];
	const transport: SkillTransport = {
		identity: {},
		current: () => live,
		ended: () => !live,
		retire: vi.fn(async () => {}),
		send: async (method, params, parse) => {
			sent.push({ method, params });
			beforeReply();
			const parsed = parse(raw);
			return parsed.success
				? ok(parsed.data)
				: err({ code: "protocol", detail: "invalid" });
		},
	};
	const api = skillRequests({
		acquire: async () => ok(transport),
		current: () => (live ? transport : undefined),
	});
	return {
		api,
		sent,
		transport,
		answer: (value: unknown) => {
			raw = value;
		},
		retireBeforeReply: () => {
			beforeReply = () => {
				live = false;
			};
		},
	};
};
const input = { sessionId: SKILL_SESSION, sourceId: SKILL_SOURCE };
const editor = {
	ok: true,
	value: {
		sessionId: SKILL_SESSION,
		source: { ...skillEntry.source, path: "secret/SKILL.md" },
	},
};

it("resolves only the captured source id and accepts a different unmasked native path", async () => {
	const s = setup();
	expect((await s.api.skillsEditor("/w", input)).ok).toBe(false);
	expect(s.sent).toEqual([]);
	await s.api.skillsList("/w");
	s.answer(editor);
	expect(await s.api.skillsEditor("/w", input)).toEqual(ok(editor));
	expect(s.sent.at(-1)).toEqual({
		method: DAEMON_METHODS.skillsEditor,
		params: input,
	});
	expect(s.transport.retire).not.toHaveBeenCalled();
});

it("refuses a replaced transport and mismatched native session/source replies without replay", async () => {
	for (const sourceId of ["b".repeat(64), SKILL_SOURCE]) {
		const s = setup();
		await s.api.skillsList("/w");
		s.answer({
			ok: true,
			value: {
				sessionId:
					sourceId === SKILL_SOURCE
						? "99999999-9999-4999-8999-999999999999"
						: SKILL_SESSION,
				source: { ...skillEntry.source, sourceId },
			},
		});
		expect((await s.api.skillsEditor("/w", input)).ok).toBe(false);
	}
	const s = setup();
	await s.api.skillsList("/w");
	s.answer(editor);
	s.retireBeforeReply();
	expect(await s.api.skillsEditor("/w", input)).toMatchObject({
		ok: false,
		error: { code: "stopped" },
	});
	expect(s.sent).toHaveLength(2);
	expect(s.transport.retire).not.toHaveBeenCalled();
});
