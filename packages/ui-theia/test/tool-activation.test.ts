import { err, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { activateTools } from "../src/application/tool-activation.js";

const ports = () => ({
	save: vi.fn(async () => true),
	status: vi.fn(async () => ok(0)),
	restart: vi.fn(async () => ok(null)),
	loaded: vi.fn(async () => true),
	test: vi.fn(async () => {}),
	pending: vi.fn(),
});

describe("safe tool activation", () => {
	it("rechecks saved pending configuration without saving or restarting when loaded", async () => {
		const deps = { ...ports(), probe: vi.fn(async () => true) };
		expect(await activateTools(deps)).toEqual({ kind: "activated" });
		expect(deps.save).not.toHaveBeenCalled();
		expect(deps.status).not.toHaveBeenCalled();
		expect(deps.restart).not.toHaveBeenCalled();
	});
	it("keeps the idle gate when a saved row is shadowed or not loaded", async () => {
		const deps = { ...ports(), probe: vi.fn(async () => false) };
		deps.status.mockResolvedValue(ok(1));
		expect(await activateTools(deps)).toEqual({
			kind: "pending",
			activeRuns: 1,
		});
		expect(deps.restart).not.toHaveBeenCalled();
		deps.status.mockResolvedValue(ok(0));
		expect(await activateTools(deps)).toEqual({ kind: "activated" });
		expect(deps.restart).toHaveBeenCalledOnce();
	});

	it("does not restart or test after invalid input or a failed save", async () => {
		const deps = ports();
		deps.save.mockResolvedValue(false);
		expect(await activateTools(deps)).toEqual({ kind: "unsaved" });
		expect(deps.status).not.toHaveBeenCalled();
		expect(deps.restart).not.toHaveBeenCalled();
	});
	it("saves but leaves activation pending during active work", async () => {
		const deps = ports();
		deps.status.mockResolvedValue(ok(2));
		expect(await activateTools(deps)).toEqual({
			kind: "pending",
			activeRuns: 2,
		});
		expect(deps.pending).toHaveBeenCalledOnce();
		expect(deps.restart).not.toHaveBeenCalled();
		expect(deps.test).not.toHaveBeenCalled();
	});
	it("fails closed when run status cannot be determined", async () => {
		const deps = {
			...ports(),
			status: vi.fn(async () => err("daemon unavailable")),
		};
		expect(await activateTools(deps)).toEqual({
			kind: "failed",
			error: "daemon unavailable",
		});
		expect(deps.restart).not.toHaveBeenCalled();
		expect(deps.test).not.toHaveBeenCalled();
	});
	it("requires atomic idle admission when no engine can report activity", async () => {
		const deps = {
			...ports(),
			status: vi.fn(async () => ok(undefined)),
			restart: vi.fn(async () => err("active work")),
		};
		expect(await activateTools(deps)).toEqual({
			kind: "failed",
			error: "active work",
		});
		expect(deps.restart).toHaveBeenCalledOnce();
		expect(deps.loaded).not.toHaveBeenCalled();
		expect(deps.test).not.toHaveBeenCalled();
		const admitted = { ...deps, restart: vi.fn(async () => ok(null)) };
		expect(await activateTools(admitted)).toEqual({ kind: "activated" });
		expect(admitted.restart).toHaveBeenCalledOnce();
		expect(admitted.test).toHaveBeenCalledOnce();
	});
	it("restarts once then tests only the configuration that was actually loaded", async () => {
		const deps = ports();
		expect(await activateTools(deps)).toEqual({ kind: "activated" });
		expect(deps.restart).toHaveBeenCalledOnce();
		expect(deps.loaded).toHaveBeenCalledOnce();
		expect(deps.test).toHaveBeenCalledOnce();
		deps.loaded.mockResolvedValue(false);
		deps.test.mockClear();
		expect(await activateTools(deps)).toEqual({
			kind: "pending",
			activeRuns: 0,
		});
		expect(deps.test).not.toHaveBeenCalled();
	});
	it("keeps pending status when restart fails", async () => {
		const deps = ports();
		deps.restart.mockRejectedValue(new Error("stopped"));
		expect(await activateTools(deps)).toMatchObject({ kind: "failed" });
		expect(deps.test).not.toHaveBeenCalled();
	});
});
