import type { MeteEvent } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "../../src/domain/event-bus.js";

const base = () => ({
	id: crypto.randomUUID(),
	ts: new Date().toISOString(),
	schema: 1 as const,
	workspaceId: crypto.randomUUID(),
	source: "core-engine",
});
const runStarted: MeteEvent = { ...base(), type: "run.started", payload: {} };
const runResumed: MeteEvent = { ...base(), type: "run.resumed", payload: {} };
const toolCalled: MeteEvent = {
	...base(),
	type: "agent.tool.called",
	payload: { capability: "fs.read@1", adapterId: "tools-fs" },
};

const setup = () => {
	const onHandlerError = vi.fn();
	return { bus: createEventBus(onHandlerError), onHandlerError };
};

describe("createEventBus", () => {
	it("delivers an exact type and nothing else", () => {
		const { bus } = setup();
		const h = vi.fn();
		bus.subscribe("run.started", h);
		bus.publish(runStarted);
		bus.publish(runResumed);
		expect(h).toHaveBeenCalledExactlyOnceWith(runStarted);
	});

	it("matches a wildcard on whole leading segments", () => {
		const { bus } = setup();
		const agent = vi.fn();
		const agentTool = vi.fn();
		const ag = vi.fn();
		bus.subscribe("agent.*", agent);
		bus.subscribe("agent.tool.*", agentTool);
		bus.subscribe("ag.*", ag);
		bus.publish(toolCalled);
		expect(agent).toHaveBeenCalledOnce();
		expect(agentTool).toHaveBeenCalledOnce();
		expect(ag).not.toHaveBeenCalled();
	});

	it("delivers in subscription order", () => {
		const { bus } = setup();
		const order: string[] = [];
		bus.subscribe("run.*", () => order.push("a"));
		bus.subscribe("run.started", () => order.push("b"));
		bus.publish(runStarted);
		expect(order).toEqual(["a", "b"]);
	});

	it("stops delivery after dispose, per subscription", () => {
		const { bus } = setup();
		const h = vi.fn();
		const first = bus.subscribe("run.started", h);
		bus.subscribe("run.started", h);
		first.dispose();
		bus.publish(runStarted);
		expect(h).toHaveBeenCalledOnce();
	});

	it("skips a subscription disposed during the same publish", () => {
		const { bus } = setup();
		const later = vi.fn();
		bus.subscribe("run.started", () => sub.dispose());
		const sub = bus.subscribe("run.started", later);
		bus.publish(runStarted);
		expect(later).not.toHaveBeenCalled();
	});

	it("does not deliver the current event to a subscription added during it", () => {
		const { bus } = setup();
		const added = vi.fn();
		bus.subscribe("run.started", () => bus.subscribe("run.started", added));
		bus.publish(runStarted);
		expect(added).not.toHaveBeenCalled();
	});

	it("routes a handler exception to the sink and keeps delivering", () => {
		const { bus, onHandlerError } = setup();
		const boom = new Error("boom");
		const next = vi.fn();
		bus.subscribe("run.started", () => {
			throw boom;
		});
		bus.subscribe("run.started", next);
		bus.publish(runStarted);
		expect(onHandlerError).toHaveBeenCalledExactlyOnceWith(boom, runStarted);
		expect(next).toHaveBeenCalledOnce();
	});

	it("throws on an event that fails its schema", () => {
		const { bus } = setup();
		const h = vi.fn();
		bus.subscribe("run.*", h);
		const bad = { ...runStarted, workspaceId: "not-a-uuid" };
		expect(() => bus.publish(bad)).toThrow(/workspaceId/);
		expect(h).not.toHaveBeenCalled();
	});
});
