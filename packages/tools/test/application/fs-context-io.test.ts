import * as files from "node:fs/promises";
import { basename, join } from "node:path";
import { FsContextInputSchema } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BINARY_SNIFF_BYTES } from "../../src/defaults.js";
import { createFsContext } from "../../src/infrastructure/fs-context.js";
import { tempWorkspace } from "../infrastructure/workspace.js";

vi.mock("node:fs/promises", async (original) => {
	const native = await original<typeof import("node:fs/promises")>();
	return {
		...native,
		open: vi.fn(native.open),
		stat: vi.fn(native.stat),
		readFile: vi.fn(native.readFile),
	};
});
const native =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let ws: Awaited<ReturnType<typeof tempWorkspace>>;
afterEach(async () => {
	vi.restoreAllMocks();
	vi.mocked(files.open).mockReset().mockImplementation(native.open);
	vi.mocked(files.stat).mockReset().mockImplementation(native.stat);
	vi.mocked(files.readFile).mockReset().mockImplementation(native.readFile);
	await ws?.close();
});
const setup = async (bytes: Uint8Array = Buffer.from("source")) => {
	ws = await tempWorkspace();
	const path = join(ws.workspaceDir, "main.ts");
	await files.writeFile(path, bytes);
	const adapter = createFsContext({ workspaceDir: ws.workspaceDir });
	const inspect = (signal = new AbortController().signal) =>
		adapter.inspect({ path: "main.ts" }, signal);
	return { adapter, path, inspect };
};

describe("native context bounded source IO", () => {
	it.each([
		Buffer.from([0]),
		Buffer.from([0x80]),
		Buffer.from([0xc0, 0xaf]),
		Buffer.from([0xed, 0xa0, 0x80]),
		Buffer.from([0xf4, 0x90, 0x80, 0x80]),
		Buffer.from([0xc3]),
	])("refuses binary or invalid UTF-8 source prefixes", async (bytes) => {
		const { inspect } = await setup(bytes);
		expect(await inspect()).toMatchObject({
			ok: false,
			error: { code: "binary" },
		});
	});

	it.each(["\u00e9", "\u20ac", "\ud83d\ude00"])(
		"accepts a valid multibyte character split at the prefix edge: %s",
		async (character) => {
			const bytes = Buffer.from(character);
			for (let kept = 1; kept < bytes.length; kept++) {
				const { inspect } = await setup(
					Buffer.concat([
						Buffer.alloc(BINARY_SNIFF_BYTES - kept, 0x61),
						bytes,
						Buffer.from("tail"),
					]),
				);
				expect(await inspect()).toEqual({
					ok: true,
					value: { path: "main.ts" },
				});
				await ws.close();
			}
		},
	);

	it("refuses an incomplete UTF-8 character at the actual file end", async () => {
		const { inspect } = await setup(
			Buffer.concat([
				Buffer.alloc(BINARY_SNIFF_BYTES - 1, 0x61),
				Buffer.from([0xe2]),
			]),
		);
		expect(await inspect()).toMatchObject({
			ok: false,
			error: { code: "binary" },
		});
	});

	it("checks only the bounded prefix of a large source, never readFile on the source", async () => {
		const { inspect } = await setup(
			Buffer.concat([
				Buffer.alloc(BINARY_SNIFF_BYTES, 0x61),
				Buffer.alloc(BINARY_SNIFF_BYTES * 16),
			]),
		);
		const handle = await native.open(join(ws.workspaceDir, "main.ts"), "r");
		const read = vi.spyOn(handle, "read");
		const close = vi.spyOn(handle, "close");
		vi.mocked(files.open).mockResolvedValueOnce(handle);
		expect(await inspect()).toEqual({ ok: true, value: { path: "main.ts" } });
		const calls: readonly (readonly unknown[])[] = read.mock.calls;
		expect(calls.map((call) => call[2])).toEqual([BINARY_SNIFF_BYTES]);
		expect(close).toHaveBeenCalledOnce();
		expect(
			vi
				.mocked(files.readFile)
				.mock.calls.every(
					([path]) =>
						typeof path === "string" && basename(path) === ".meteignore",
				),
		).toBe(true);
	});

	it("closes the source handle on read errors without exposing raw error text", async () => {
		const { inspect, path } = await setup();
		const handle = await native.open(path, "r");
		vi.spyOn(handle, "read").mockRejectedValueOnce(
			new Error("secret source details"),
		);
		const close = vi.spyOn(handle, "close");
		vi.mocked(files.open).mockResolvedValueOnce(handle);
		const result = await inspect();
		expect(result).toMatchObject({ ok: false, error: { code: "io" } });
		expect(JSON.stringify(result)).not.toContain("secret source details");
		expect(close).toHaveBeenCalledOnce();
	});

	it("continues after a short read without confusing it with EOF", async () => {
		const { inspect, path } = await setup(Buffer.from("\u20ac"));
		const handle = await native.open(path, "r");
		const readNative = handle.read.bind(handle);
		vi.spyOn(handle, "read").mockImplementationOnce(
			async (...args: unknown[]) => {
				const buffer = args[0];
				if (!Buffer.isBuffer(buffer))
					throw new Error("Expected native read buffer");
				return readNative(buffer, 0, 1, 0);
			},
		);
		vi.mocked(files.open).mockResolvedValueOnce(handle);
		expect(await inspect()).toEqual({ ok: true, value: { path: "main.ts" } });
	});

	it("closes a handle if cancellation arrives while opening it", async () => {
		const { inspect, path } = await setup();
		const controller = new AbortController();
		const handle = await native.open(path, "r");
		const close = vi.spyOn(handle, "close");
		vi.mocked(files.open).mockImplementationOnce(async () => {
			controller.abort();
			return handle;
		});
		expect(await inspect(controller.signal)).toMatchObject({
			ok: false,
			error: { code: "io" },
		});
		expect(close).toHaveBeenCalledOnce();
	});

	it("refuses pre-cancellation without opening a source", async () => {
		const { inspect } = await setup();
		const controller = new AbortController();
		controller.abort();
		expect(await inspect(controller.signal)).toMatchObject({
			ok: false,
			error: { code: "io" },
		});
		expect(files.open).not.toHaveBeenCalled();
	});

	it("closes an opened handle when cancellation arrives during a read", async () => {
		const { inspect, path } = await setup();
		const controller = new AbortController();
		const handle = await native.open(path, "r");
		vi.spyOn(handle, "read").mockImplementationOnce(async () => {
			controller.abort();
			throw new Error("aborted");
		});
		const close = vi.spyOn(handle, "close");
		vi.mocked(files.open).mockResolvedValueOnce(handle);
		expect(await inspect(controller.signal)).toMatchObject({
			ok: false,
			error: { code: "io" },
		});
		expect(close).toHaveBeenCalledOnce();
	});

	it("fails closed on unreadable ignore rules and nonregular source metadata", async () => {
		const { inspect } = await setup();
		vi.mocked(files.readFile).mockRejectedValueOnce(
			Object.assign(new Error("private rule details"), { code: "EIO" }),
		);
		expect(await inspect()).toMatchObject({ ok: false, error: { code: "io" } });
		const metadata = await native.stat(join(ws.workspaceDir, "main.ts"));
		vi.mocked(files.stat).mockResolvedValueOnce(
			Object.assign(metadata, { isFile: () => false }),
		);
		expect(await inspect()).toMatchObject({
			ok: false,
			error: { code: "bad_input" },
		});
	});

	it("refuses strict schema violations at the native boundary", async () => {
		const { adapter } = await setup();
		for (const input of [
			{ path: "main.ts", cwd: ws.globalDir },
			{ path: "" },
			{ path: "main.ts\0" },
		]) {
			expect(FsContextInputSchema.safeParse(input).success).toBe(false);
			expect(
				await adapter.inspect(input, new AbortController().signal),
			).toMatchObject({
				ok: false,
				error: { code: "bad_input" },
			});
		}
	});
});
