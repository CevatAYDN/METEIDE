import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { draftOf, teamOf } from "../src/application/team-draft.js";
import { orderOfWork } from "../src/application/work-order.js";

// The order of work (ADR-093), on the team file of web-dev and on small teams written for the cases.

const team = (yaml: string) => {
	const doc = draftOf(yaml);
	if (!doc.ok) throw new Error(doc.error);
	return teamOf(doc.value);
};
const titles = (yaml: string) => orderOfWork(team(yaml)).map((s) => s.title);

const WEB_DEV = readFileSync(
	join(__dirname, "..", "..", "..", "templates", "web-dev.yaml"),
	"utf8",
);

describe("orderOfWork", () => {
	it("lists web-dev's tasks as the file chains them, each with its member, what it waits for and its approver", () => {
		const steps = orderOfWork(team(WEB_DEV));
		expect(steps.map((s) => s.memberName)).toEqual([
			"UI designer",
			"Frontend developer",
			"QA",
		]);
		expect(steps.map((s) => s.after)).toEqual([
			[],
			[steps[0]?.title],
			[steps[1]?.title],
		]);
		expect(steps.map((s) => s.approver)).toEqual([
			{ kind: "role", name: "Lead" },
			{ kind: "role", name: "Lead" },
			{ kind: "role", name: "Lead" },
		]);
		expect(steps.map((s) => s.member)).toEqual([0, 1, 2]);
	});

	it("starts the tasks that wait for none first, whatever their place in the file, each round in the file's order", () => {
		const out = titles(`
roles: [{ id: r, name: R }]
tasks:
  - { id: a, role: r, title: A, context: [b] }
  - { id: b, role: r, title: B }
  - { id: c, role: r, title: C }
  - { id: d, role: r, title: D, context: [a, c] }
`);
		expect(out).toEqual(["B", "C", "A", "D"]);
	});

	it("puts tasks that wait for each other last in the file's order, and does not hold one back for an id no task has", () => {
		const out = titles(`
roles: [{ id: r, name: R }]
tasks:
  - { id: a, role: r, title: A, context: [b] }
  - { id: b, role: r, title: B, context: [a] }
  - { id: c, role: r, title: C, context: [nobody] }
  - { id: s, role: r, title: S, context: [s] }
`);
		expect(out).toEqual(["C", "A", "B", "S"]);
	});

	it("names the human as an approver, a role by its name or else its id, and a task whose member is gone as unselectable", () => {
		const steps = orderOfWork(
			team(`
roles: [{ id: r, name: R }]
tasks:
  - { id: a, role: r, title: A, approval: human }
  - { id: b, role: gone, title: "", approval: ghost }
`),
		);
		expect(steps[0]?.approver).toEqual({ kind: "human" });
		expect(steps[1]).toMatchObject({
			title: "b",
			member: -1,
			memberName: "gone",
			approver: { kind: "role", name: "ghost" },
		});
	});

	it("says nothing for a team without tasks", () => {
		expect(orderOfWork(team("roles: []"))).toEqual([]);
	});
});
