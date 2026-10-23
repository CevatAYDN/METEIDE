import "reflect-metadata";
import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	type FolderEvent,
	MeteDaemonEvents,
} from "../src/application/daemon-events.js";

describe("the frontend's event channel", () => {
	it("hands every event the backend calls with to each listener, with its folder", () => {
		const events = new MeteDaemonEvents();
		const seen: FolderEvent[] = [];
		const sub = events.onDidReceive((e) => void seen.push(e));
		const event = { type: "run.started" } as MeteEvent;
		events.onEvent("/w", event);
		sub.dispose();
		events.onEvent("/w", event);
		expect(seen).toEqual([{ workspaceDir: "/w", event }]);
	});
});
