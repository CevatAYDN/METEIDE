import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LOCK_RETRY_DELAYS_MS } from "../../src/defaults.js";
import {
	globalDataDir,
	withLockRetry,
} from "../../src/infrastructure/platform.js";

const lockError = () => Object.assign(new Error("busy"), { code: "EBUSY" });

describe("globalDataDir", () => {
	it("uses APPDATA on Windows", () => {
		expect(globalDataDir({ APPDATA: "C:\\AppData" }, "win32", "C:\\home")).toBe(
			join("C:\\AppData", "METE"),
		);
	});

	it("uses XDG_DATA_HOME on Linux, else ~/.local/share", () => {
		expect(globalDataDir({ XDG_DATA_HOME: "/xdg" }, "linux", "/home/u")).toBe(
			join("/xdg", "mete"),
		);
		expect(globalDataDir({}, "linux", "/home/u")).toBe(
			join("/home/u", ".local", "share", "mete"),
		);
	});

	it("uses Application Support on macOS", () => {
		expect(globalDataDir({}, "darwin", "/Users/u")).toBe(
			join("/Users/u", "Library", "Application Support", "METE"),
		);
	});
});

describe("withLockRetry", () => {
	it("retries a Windows lock error with the documented delays", async () => {
		const sleep = vi.fn(async (_ms: number) => {});
		let calls = 0;
		const op = async () => {
			calls += 1;
			if (calls <= LOCK_RETRY_DELAYS_MS.length) throw lockError();
			return "done";
		};
		await expect(withLockRetry(op, "win32", sleep)).resolves.toBe("done");
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
			...LOCK_RETRY_DELAYS_MS,
		]);
	});

	it("gives up after the last delay", async () => {
		const op = async () => {
			throw lockError();
		};
		await expect(withLockRetry(op, "win32", async () => {})).rejects.toThrow(
			"busy",
		);
	});

	it("does not retry other errors or other platforms", async () => {
		const sleep = vi.fn(async () => {});
		const missing = Object.assign(new Error("gone"), { code: "ENOENT" });
		await expect(
			withLockRetry(async () => Promise.reject(missing), "win32", sleep),
		).rejects.toThrow("gone");
		await expect(
			withLockRetry(async () => Promise.reject(lockError()), "linux", sleep),
		).rejects.toThrow("busy");
		expect(sleep).not.toHaveBeenCalled();
	});
});
