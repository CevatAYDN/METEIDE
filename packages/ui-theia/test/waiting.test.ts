import "reflect-metadata";
import { StatusBar } from "@theia/core/lib/browser/status-bar/status-bar-types";
import { Emitter } from "@theia/core/lib/common/event";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import { Container } from "@theia/core/shared/inversify";
import { describe, expect, it, vi } from "vitest";
import { type HomeModel, homeModel } from "../src/domain/home-model.js";
import type { StatusRuns } from "../src/domain/status-service.js";
import { MeteHomeStore } from "../src/infrastructure/home-store.js";
import {
	followWaiting,
	MeteWaitingStatusBar,
	SHOW_WAITING_COMMAND,
} from "../src/infrastructure/waiting.js";

// What waits for the user outside the METE view's list (ADR-078): the status bar's count and the
// Waiting for you part. Both change only when the count does; the window has no waiting run to show.
// The store's real module loads the workspace service and lumino; only its identity is used here.
vi.mock("../src/infrastructure/home-store.js", () => ({
	MeteHomeStore: class MeteHomeStore {},
}));

const AT = "2026-10-24T10:00:00.000Z";

const run = (pauseReason?: string) =>
	({
		...(pauseReason ? { pauseReason } : {}),
		id: crypto.randomUUID(),
		workspaceId: crypto.randomUUID(),
		templateId: "duo",
		goal: "g",
		status: pauseReason ? "paused" : "running",
		autonomyLevel: 2,
		budget: { cloudRequests: 10, maxHours: 1 },
		createdAt: AT,
	}) as StatusRuns[number];

const waiting = (n: number) =>
	homeModel(
		{
			ok: true,
			value: [run(), ...Array.from({ length: n }, () => run("approval"))],
		},
		AT,
	);

// A store the tests drive: set a model, and the listeners hear of it.
const fakeStore = () => {
	const changed = new Emitter<void>();
	const store = {
		model: { kind: "loading" } as HomeModel,
		onDidChange: changed.event,
		set(model: HomeModel) {
			store.model = model;
			changed.fire();
		},
	};
	return store;
};

describe("the status bar's waiting count", () => {
	const setup = () => {
		const store = fakeStore();
		const calls: string[] = [];
		const c = new Container();
		c.bind(MeteHomeStore).toConstantValue(store as unknown as MeteHomeStore);
		c.bind(StatusBar).toConstantValue({
			setElement: async (id: string, e: { text: string; command: string }) =>
				void calls.push(`set ${id} ${e.text} -> ${e.command}`),
			removeElement: async (id: string) => void calls.push(`remove ${id}`),
		});
		c.bind(MeteWaitingStatusBar).toSelf();
		c.get(MeteWaitingStatusBar).onStart();
		return { store, calls };
	};

	it("shows while runs wait, follows the count, and goes when none waits", async () => {
		const { store, calls } = setup();
		store.set(waiting(0));
		store.set(waiting(2));
		store.set(waiting(2));
		store.set(waiting(1));
		store.set(waiting(0));
		await Promise.resolve();
		expect(calls).toEqual([
			`set mete.waiting $(bell-dot) 2 waiting for you -> ${SHOW_WAITING_COMMAND.id}`,
			`set mete.waiting $(bell-dot) 1 waiting for you -> ${SHOW_WAITING_COMMAND.id}`,
			"remove mete.waiting",
		]);
	});
});

// The METE view as followWaiting sees it: the Waiting for you part, Runs, a collapsed Workspaces and
// Quota, each with its height, and the sizes the view was given.
const fakeView = (visible: boolean) => {
	const store = fakeStore();
	const shown = new Emitter<boolean>();
	const hidden: boolean[] = [];
	const sized: (number | undefined)[][] = [];
	const part = {
		isHidden: false,
		collapsed: false,
		setHidden: (h: boolean) => {
			part.isHidden = h;
			hidden.push(h);
		},
	};
	const runs = { isHidden: false, collapsed: false };
	const folders = { isHidden: false, collapsed: true };
	const quota = { isHidden: false, collapsed: false };
	const heights = new Map<object, number>([
		[part, 72],
		[runs, 450],
		[folders, 22],
		[quota, 150],
	]);
	let closed: (() => void) | undefined;
	const container = {
		isVisible: visible,
		onDidChangeVisibility: shown.event,
		getPartFor: () => part,
		disposed: {
			connect: (f: () => void) => {
				closed = f;
			},
		},
		containerLayout: {
			widgets: [part, runs, folders, quota],
			getPartSize: (p: object) => heights.get(p),
			setPartSizes: (w: (number | undefined)[]) => void sized.push(w),
		},
	};
	followWaiting(
		container as unknown as Parameters<typeof followWaiting>[0],
		{} as Widget,
		store,
		0.2,
	);
	const show = () => {
		container.isVisible = true;
		shown.fire(true);
	};
	return { store, part, hidden, sized, show, close: () => closed?.() };
};

describe("the Waiting for you part", () => {
	it("hides while nothing waits and shows when a run starts waiting, only when the count crosses zero", () => {
		const { store, hidden, close } = fakeView(true);
		store.set(waiting(0));
		store.set(waiting(1));
		store.set(waiting(3));
		store.set(waiting(0));
		expect(hidden).toEqual([true, false, true]);
		// A closed view stops following the store.
		close();
		store.set(waiting(2));
		expect(hidden).toEqual([true, false, true]);
	});

	it("hides again when a restored layout shows it while nothing waits, and keeps it hidden if the user hid it while runs wait", () => {
		const { store, part, hidden } = fakeView(true);
		store.set(waiting(0));
		// Theia's layout restore shows the part as it was saved.
		part.isHidden = false;
		store.set(waiting(0));
		expect(hidden).toEqual([true, true]);
		store.set(waiting(1));
		part.isHidden = true;
		store.set(waiting(2));
		expect(hidden).toEqual([true, true, false]);
	});

	it("comes back with its share of the height, the open parts keeping theirs", () => {
		const { store, sized } = fakeView(true);
		store.set(waiting(0));
		store.set(waiting(2));
		// Runs and Quota hold 600 px: a fifth of the whole is 150 px; collapsed Workspaces keeps its size.
		expect(sized).toEqual([[150, 450, undefined, 150]]);
	});

	it("takes its share a frame after the view shows, since a hidden side bar measures nothing and a shown one is fitted on that frame", () => {
		const frames = new Map<number, () => void>();
		vi.stubGlobal("requestAnimationFrame", (f: () => void) => {
			frames.set(frames.size + 1, f);
			return frames.size;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
		const { store, sized, show, close } = fakeView(false);
		store.set(waiting(0));
		store.set(waiting(1));
		store.set(waiting(0));
		store.set(waiting(1));
		expect(sized).toEqual([]);
		show();
		show();
		expect(sized).toEqual([]);
		for (const f of frames.values()) f();
		expect(sized).toEqual([[150, 450, undefined, 150]]);
		frames.clear();
		// A view closed between its show and the frame sizes nothing.
		const late = fakeView(false);
		late.store.set(waiting(1));
		late.show();
		late.close();
		for (const f of frames.values()) f();
		expect(late.sized).toEqual([]);
		close();
		vi.unstubAllGlobals();
	});

	it("leaves a part the user collapsed at its header", () => {
		const { store, part, sized } = fakeView(true);
		store.set(waiting(0));
		part.collapsed = true;
		store.set(waiting(1));
		expect(sized).toEqual([]);
	});
});
