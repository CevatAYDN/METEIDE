import { expect, it } from "vitest";
import {
	contextScope,
	createContextDrafts,
} from "../src/application/context-drafts.js";
import { required } from "./required-fixture.js";

const snapshot = {
	path: "a.ts",
	content: "masked",
	modified: true,
	sha256: "a".repeat(64),
};
const a = contextScope("/w", "conversation");
const b = contextScope("/other", "conversation");

it("keeps authored text and fixed masked snapshots across navigation without scope leaks", () => {
	const drafts = createContextDrafts(() => {});
	drafts.select(a);
	drafts.message(a, "authored");
	const ticket = drafts.prepare(a);
	expect(ticket).toBeDefined();
	drafts.complete(required(ticket), { snapshot, sourcePath: "/w/a.ts" });
	snapshot.content = "editor changed";
	expect(drafts.read(a).attachments[0]?.snapshot.content).toBe("masked");
	drafts.select(b);
	expect(drafts.read(b).message).toBe("");
	expect(drafts.read(b).attachments).toEqual([]);
	drafts.select(a);
	expect(drafts.read(a).message).toBe("authored");
	expect(drafts.read(a).attachments[0]?.snapshot.content).toBe("masked");
});

it("discards late preparation after navigation and preserves the old copy on update failure", () => {
	const drafts = createContextDrafts(() => {});
	drafts.select(a);
	drafts.complete(required(drafts.prepare(a)), {
		snapshot,
		sourcePath: "/w/a.ts",
	});
	const original = required(drafts.read(a).attachments[0]);
	const update = required(drafts.prepare(a, original.id));
	drafts.complete(update, undefined, "source unavailable");
	expect(drafts.read(a).attachments[0]).toEqual(original);
	expect(drafts.read(a).error).toBe("source unavailable");
	const late = required(drafts.prepare(a));
	drafts.select(b);
	drafts.complete(late, { snapshot, sourcePath: "/w/b.ts" });
	expect(drafts.read(b).attachments).toEqual([]);
	expect(drafts.read(a).attachments).toHaveLength(1);
	expect(drafts.read(a).busy).toBe(false);
});

it("locks edits during send and clears only the exact successful draft", () => {
	const drafts = createContextDrafts(() => {});
	drafts.select(a);
	drafts.message(a, "keep");
	drafts.complete(required(drafts.prepare(a)), {
		snapshot,
		sourcePath: "/w/a.ts",
	});
	const frozen = required(drafts.lock(a));
	drafts.message(a, "cannot edit");
	drafts.remove(a, required(drafts.read(a).attachments[0]).id);
	expect(drafts.prepare(a)).toBeUndefined();
	expect(drafts.read(a).message).toBe("keep");
	drafts.finish(a, frozen.revision, false);
	expect(drafts.read(a).attachments).toHaveLength(1);
	const success = required(drafts.lock(a));
	drafts.select(b);
	drafts.message(b, "other");
	drafts.finish(a, success.revision, true);
	expect(drafts.read(a).message).toBe("");
	expect(drafts.read(a).attachments).toEqual([]);
	expect(drafts.read(b).message).toBe("other");
});

it("refuses a fifth attachment and UTF8 total overflow without truncation", () => {
	const drafts = createContextDrafts(() => {});
	drafts.select(a);
	for (let index = 0; index < 4; index++)
		drafts.complete(required(drafts.prepare(a)), {
			snapshot: { ...snapshot, content: "x" },
			sourcePath: "/w/a.ts",
		});
	const fifth = required(drafts.prepare(a));
	expect(drafts.complete(fifth, { snapshot, sourcePath: "/w/b.ts" })).toBe(
		false,
	);
	expect(drafts.read(a).attachments).toHaveLength(4);
	const bounded = createContextDrafts(() => {});
	bounded.select(a);
	for (let index = 0; index < 2; index++)
		bounded.complete(required(bounded.prepare(a)), {
			snapshot: { ...snapshot, content: "\u00E9".repeat(16384) },
			sourcePath: "/w/a.ts",
		});
	expect(
		bounded.complete(required(bounded.prepare(a)), {
			snapshot: { ...snapshot, content: "x" },
			sourcePath: "/w/a.ts",
		}),
	).toBe(false);
	expect(bounded.read(a).attachments).toHaveLength(2);
});

it("keeps semantic revision on failed, stale, overflow and identical preparation", () => {
	const drafts = createContextDrafts(() => {});
	drafts.select(a);
	for (let index = 0; index < 4; index++)
		drafts.complete(required(drafts.prepare(a)), {
			snapshot,
			sourcePath: "/w/a.ts",
		});
	const before = drafts.read(a);
	const failed = required(drafts.prepare(a));
	drafts.complete(failed, undefined, "unavailable");
	expect(drafts.read(a).revision).toBe(before.revision);
	const stale = required(drafts.prepare(a));
	drafts.select(b);
	drafts.complete(stale, { snapshot, sourcePath: "/w/b.ts" });
	expect(drafts.read(a).revision).toBe(before.revision);
	drafts.select(a);
	drafts.complete(required(drafts.prepare(a)), {
		snapshot,
		sourcePath: "/w/b.ts",
	});
	expect(drafts.read(a).revision).toBe(before.revision);
	const original = required(before.attachments[0]);
	drafts.complete(required(drafts.prepare(a, original.id)), original);
	expect(drafts.read(a).revision).toBe(before.revision);
	const latest = required(drafts.prepare(a));
	expect(drafts.complete(failed, { snapshot, sourcePath: "/w/a.ts" })).toBe(
		false,
	);
	expect(drafts.read(a).busy).toBe(true);
	drafts.complete(latest, undefined, "unavailable");
	expect(drafts.read(a).attachments).toEqual(before.attachments);
});
