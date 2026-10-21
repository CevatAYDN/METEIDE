import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lockHolder, takeRunLock } from "../src/infrastructure/run-lock.js";

let dir = "";
afterEach(() => rm(dir, { recursive: true, force: true }));

const lockIn = async () => {
	dir = await mkdtemp(join(tmpdir(), "mete-lock-"));
	return join(dir, "cache", "run.lock");
};
const NO_SUCH_PID = 99_999_999;

describe("run lock", () => {
	it("takes a free lock with this pid and frees it on release", async () => {
		const file = await lockIn();
		const r = await takeRunLock(file);
		if (!r.ok) throw new Error(r.error);
		expect((await readFile(file, "utf8")).trim()).toBe(String(process.pid));
		expect(await lockHolder(file)).toBe(process.pid);
		await r.value();
		expect(await lockHolder(file)).toBeUndefined();
	});

	it("refuses while a live process holds it, and names that process", async () => {
		const file = await lockIn();
		const held = await takeRunLock(file);
		if (!held.ok) throw new Error(held.error);
		const second = await takeRunLock(file);
		expect(second.ok ? "taken" : second.error).toContain(`pid ${process.pid}`);
		await held.value();
	});

	it("takes over the lock of a process that is gone", async () => {
		const file = await lockIn();
		const first = await takeRunLock(file);
		if (first.ok) await first.value();
		await writeFile(file, `${NO_SUCH_PID}\n`);
		expect(await lockHolder(file)).toBeUndefined();
		const r = await takeRunLock(file);
		expect(r.ok).toBe(true);
		if (r.ok) await r.value();
	});
});
