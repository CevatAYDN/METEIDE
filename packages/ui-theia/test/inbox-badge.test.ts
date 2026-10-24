import "reflect-metadata";
import type { Title, Widget } from "@theia/core/shared/@lumino/widgets";
import { describe, expect, it } from "vitest";
import { MeteInboxBadge } from "../src/infrastructure/inbox-badge.js";

// The Approvals inbox badge: the Home tab only, hidden at zero, redrawn only on a new count.

const tab = (id: string) => ({ owner: { id } }) as unknown as Title<Widget>;

describe("the inbox badge", () => {
	it("counts the runs that wait on the Home tab, and on no other tab", () => {
		const badge = new MeteInboxBadge();
		badge.set(2);
		expect(badge.decorate(tab("mete.view"))).toEqual([
			{ badge: 2, tooltip: "2 runs wait for you" },
		]);
		badge.set(1);
		expect(badge.decorate(tab("mete.view"))).toEqual([
			{ badge: 1, tooltip: "1 run waits for you" },
		]);
		expect(badge.decorate(tab("mete.board"))).toEqual([]);
		badge.set(0);
		expect(badge.decorate(tab("mete.view"))).toEqual([]);
	});

	it("asks the tab bar to redraw only when the count changes", () => {
		const badge = new MeteInboxBadge();
		let fired = 0;
		badge.onDidChangeDecorations(() => fired++);
		badge.set(2);
		badge.set(2);
		badge.set(0);
		expect(fired).toBe(2);
	});
});
