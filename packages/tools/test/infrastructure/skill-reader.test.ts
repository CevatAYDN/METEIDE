import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { SKILL_LIMITS } from "@mete/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { listSkillSources } from "../../src/infrastructure/skill-enumeration.js";
import { readSkillSource } from "../../src/infrastructure/skill-reader.js";
import { tempWorkspace } from "./workspace.js";

vi.mock("node:fs/promises", async (original) => {
	const native = await original<typeof import("node:fs/promises")>();
	return { ...native, open: vi.fn(native.open) };
});
const native =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let ws: Awaited<ReturnType<typeof tempWorkspace>>;
let held: FileHandle | undefined;
afterEach(async () => {
	if (held && held.fd >= 0) await held.close();
	held = undefined;
	vi.restoreAllMocks();
	vi.mocked(fs.open).mockReset().mockImplementation(native.open);
	await ws?.close();
});
const setup = async (bytes: Uint8Array, global = false) => {
	ws = await tempWorkspace();
	const path = await ws.put(
		global ? "skills/one/SKILL.md" : ".mete/skills/one/SKILL.md",
		"",
		global ? ws.globalDir : ws.workspaceDir,
	);
	await fs.writeFile(path, bytes);
	const inventory = await listSkillSources(ws, new AbortController().signal);
	if (!inventory.ok || !inventory.value.sources[0])
		throw new Error("Expected a source");
	const input = { sourceId: inventory.value.sources[0].sourceId };
	const read = (signal = new AbortController().signal) =>
		readSkillSource(ws, input, signal);
	return { path, read };
};

it.each([
	Buffer.alloc(0),
	Buffer.from("\ufeffline\r\n"),
	Buffer.alloc(SKILL_LIMITS.fileBytes, 0x61),
])("preserves exact UTF-8 bytes and hash", async (bytes) => {
	const { read } = await setup(bytes, true);
	expect(await read()).toMatchObject({
		ok: true,
		value: {
			text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
			sha256: createHash("sha256").update(bytes).digest("hex"),
		},
	});
});

it.each([
	Buffer.alloc(SKILL_LIMITS.fileBytes + 1, 0x61),
	Buffer.from([0]),
	Buffer.from([0xc3]),
	Buffer.from([0xc0, 0xaf]),
])("refuses oversized, NUL or invalid UTF-8 bytes", async (bytes) => {
	const { read } = await setup(bytes);
	expect(await read()).toMatchObject({
		ok: false,
		error: {
			code:
				bytes.length > SKILL_LIMITS.fileBytes ? "limit_exceeded" : "bad_input",
		},
	});
});

it("loops through short reads within the ceiling and closes once", async () => {
	const bytes = Buffer.from("\u20ac");
	const { path, read } = await setup(bytes);
	const handle = await native.open(path, "r");
	const nativeRead = handle.read.bind(handle);
	const calls = vi
		.spyOn(handle, "read")
		.mockImplementationOnce(async (...args: unknown[]) => {
			if (!Buffer.isBuffer(args[0])) throw new Error("Expected a buffer");
			return nativeRead(args[0], 0, 1, 0);
		});
	const close = vi.spyOn(handle, "close");
	vi.mocked(fs.open).mockResolvedValueOnce(handle);
	expect(await read()).toMatchObject({ ok: true, value: { text: "\u20ac" } });
	const argumentsUsed: readonly (readonly unknown[])[] = calls.mock.calls;
	expect(
		argumentsUsed.every(
			([buffer]) =>
				Buffer.isBuffer(buffer) && buffer.length === SKILL_LIMITS.fileBytes + 1,
		),
	).toBe(true);
	expect(close).toHaveBeenCalledOnce();
});

it.each(["ignore", "replace", "hardlink", "delete", "change"])(
	"refuses a %s race and closes the held descriptor",
	async (race) => {
		const { path, read } = await setup(Buffer.from("private body"));
		const handle = await native.open(path, "r");
		const close = vi.spyOn(handle, "close");
		if (race === "change") {
			const nativeRead = handle.read.bind(handle);
			vi.spyOn(handle, "read").mockImplementationOnce(
				async (...args: unknown[]) => {
					if (!Buffer.isBuffer(args[0])) throw new Error("Expected a buffer");
					const bytes = await nativeRead(args[0], 0, args[0].length, 0);
					await fs.writeFile(path, "changed body");
					await fs.utimes(path, 0, 1);
					return bytes;
				},
			);
		}
		vi.mocked(fs.open).mockImplementationOnce(async () => {
			if (race === "ignore") await ws.put(".meteignore", ".mete/skills/one/\n");
			if (race === "replace") {
				await fs.rename(path, `${path}.old`);
				await fs.writeFile(path, "replacement");
			}
			if (race === "hardlink") await fs.link(path, `${path}.copy`);
			if (race === "delete") await fs.unlink(path);
			return handle;
		});
		const result = await read();
		expect(result).toMatchObject({ ok: false });
		expect(JSON.stringify(result)).not.toContain("private body");
		expect(close).toHaveBeenCalledOnce();
	},
);

it("refuses a link race and closes the held descriptor", async () => {
	const { path, read } = await setup(Buffer.from("private body"));
	const child = join(ws.workspaceDir, ".mete", "skills", "one");
	const close = vi.fn<() => Promise<void>>();
	let linked = false;
	vi.mocked(fs.open).mockImplementationOnce(async () => {
		// Windows cannot rename this directory with a descendant file open.
		await fs.rename(child, `${child}-old`);
		await fs.symlink(`${child}-old`, child, "junction");
		linked = (await fs.lstat(child)).isSymbolicLink();
		held = await native.open(path, "r");
		close.mockImplementation(held.close.bind(held));
		vi.spyOn(held, "close").mockImplementation(close);
		return held;
	});
	const result = await read();
	expect(linked).toBe(true);
	expect(fs.open).toHaveBeenCalledOnce();
	expect(result).toMatchObject({
		ok: false,
		error: { code: "bad_input", location: "source" },
	});
	expect(JSON.stringify(result)).not.toContain("private body");
	expect(close).toHaveBeenCalledOnce();
	expect(held?.fd).toBe(-1);
});

it.each(["open", "read"])("closes on cancellation during %s", async (when) => {
	const { path, read } = await setup(Buffer.from("body"));
	const controller = new AbortController();
	const handle = await native.open(path, "r");
	const close = vi.spyOn(handle, "close");
	vi.mocked(fs.open).mockImplementationOnce(async () => {
		if (when === "open") controller.abort();
		return handle;
	});
	if (when === "read")
		vi.spyOn(handle, "read").mockImplementationOnce(async () => {
			controller.abort();
			throw new Error("private native error");
		});
	expect(await read(controller.signal)).toEqual({
		ok: false,
		error: { code: "aborted" },
	});
	expect(close).toHaveBeenCalledOnce();
});
