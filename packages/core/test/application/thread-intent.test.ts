import type { SkillPolicy } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	replyIntent,
	startIntent,
} from "../../src/application/thread-intent.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const start = {
	requestId: id(1),
	goal: "Fix the bug",
	capabilities: [],
} as Parameters<typeof startIntent>[0];
const reply = {
	requestId: id(2),
	conversationId: id(3),
	expectedRunId: id(4),
	message: "Continue",
} as Parameters<typeof replyIntent>[0];
const v = (n: number) => ({
	sourceId: n.toString(16).padStart(64, "0"),
	sha256: "b".repeat(64),
	revision: 1,
});
const policy = (over: Partial<SkillPolicy> = {}): SkillPolicy => ({
	mode: "manual",
	selected: [v(1), v(2)],
	...over,
});

describe("conversation.thread@3 intent identity", () => {
	it("keeps @1 and @2 digests unchanged when skills are absent", () => {
		expect(startIntent(start, []).digest).toBe(
			startIntent(start, [], {}).digest,
		);
		expect(replyIntent(reply, []).digest).toBe(
			replyIntent(reply, [], {}).digest,
		);
	});

	it("separates an @3 intent from the legacy namespace", () => {
		const auto: { skills: SkillPolicy } = {
			skills: { mode: "auto", selected: [] },
		};
		expect(startIntent(start, [], auto).digest).not.toBe(
			startIntent(start, []).digest,
		);
	});

	it("covers the full ordered policy, not a set", () => {
		const a = startIntent(start, [], { skills: policy() }).digest;
		const reordered = startIntent(start, [], {
			skills: policy({ selected: [v(2), v(1)] }),
		}).digest;
		const mode = startIntent(start, [], {
			skills: policy({ mode: "auto" }),
		}).digest;
		const revision = startIntent(start, [], {
			skills: policy({ selected: [v(1), { ...v(2), revision: 2 }] }),
		}).digest;
		expect(new Set([a, reordered, mode, revision]).size).toBe(4);
	});

	it("ignores caller key order of an identical policy", () => {
		const shuffled = {
			selected: [v(1), v(2)].map(({ revision, sha256, sourceId }) => ({
				revision,
				sha256,
				sourceId,
			})),
			mode: "manual",
		} as SkillPolicy;
		expect(startIntent(start, [], { skills: shuffled }).digest).toBe(
			startIntent(start, [], { skills: policy() }).digest,
		);
	});

	it("keeps a reply's omitted policy distinct from explicit auto", () => {
		const omitted = replyIntent(reply, [], { skills: null }).digest;
		const auto = replyIntent(reply, [], {
			skills: { mode: "auto", selected: [] },
		}).digest;
		expect(omitted).not.toBe(auto);
		expect(omitted).not.toBe(replyIntent(reply, []).digest);
	});
});
