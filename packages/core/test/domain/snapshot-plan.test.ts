import { describe, expect, it } from "vitest";
import { restorePlan } from "../../src/domain/snapshot-plan.js";

// Restoring file snapshot n undoes every step from n on (ADR-080).

const SNAPSHOTS = [
	{ n: 1, entries: [{ path: "a.txt", existed: true }] },
	{
		n: 2,
		entries: [
			{ path: "a.txt", existed: true },
			{ path: "new.txt", existed: false },
		],
	},
	{
		n: 3,
		entries: [
			{ path: "b.txt", existed: true },
			{ path: "new.txt", existed: true },
		],
	},
];

describe("the snapshot restore plan", () => {
	it("takes each file from the lowest snapshot from n on that holds it, and deletes one that did not exist", () => {
		expect(restorePlan(SNAPSHOTS, 2)).toEqual([
			{ path: "a.txt", from: 2 },
			{ path: "b.txt", from: 3 },
			{ path: "new.txt", delete: true },
		]);
	});

	it("reaches back to the first snapshot, and touches nothing for a snapshot past the last", () => {
		expect(restorePlan(SNAPSHOTS, 1)).toEqual([
			{ path: "a.txt", from: 1 },
			{ path: "b.txt", from: 3 },
			{ path: "new.txt", delete: true },
		]);
		expect(restorePlan(SNAPSHOTS, 3)).toEqual([
			{ path: "b.txt", from: 3 },
			{ path: "new.txt", from: 3 },
		]);
		expect(restorePlan(SNAPSHOTS, 4)).toEqual([]);
	});
});
