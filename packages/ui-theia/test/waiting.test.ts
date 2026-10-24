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

describe("the Waiting for you part", () => {
	it("hides while nothing waits and shows when a run starts waiting, only when the count crosses zero", () => {
		const store = fakeStore();
		const hidden: boolean[] = [];
		const part = { setHidden: (h: boolean) => void hidden.push(h) };
		let disposedListener: (() => void) | undefined;
		const container = {
			getPartFor: () => part,
			disposed: {
				connect: (f: () => void) => {
					disposedListener = f;
				},
			},
		};
		followWaiting(
			container as unknown as Parameters<typeof followWaiting>[0],
			{} as Widget,
			store,
		);
		store.set(waiting(0));
		store.set(waiting(1));
		store.set(waiting(3));
		store.set(waiting(0));
		expect(hidden).toEqual([true, false, true]);
		// A closed view stops following the store.
		disposedListener?.();
		store.set(waiting(2));
		expect(hidden).toEqual([true, false, true]);
	});
});
