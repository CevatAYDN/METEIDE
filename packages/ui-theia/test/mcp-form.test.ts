import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { EMPTY_MCP_SERVER } from "../src/application/mcp-draft.js";
import { McpForm } from "../src/infrastructure/mcp-form.js";

// The MCP servers card's file (ADR-097) over a fake file service: servers read from the file the
// card shows, the scope switch keeping what was typed, and Save writing only into its own file.

const WORK = URI.fromFilePath("/w");
const GLOBAL = "/g/settings.yaml";
const GLOBAL_KEY = URI.fromFilePath(GLOBAL).path.fsPath();
const WORK_KEY = WORK.resolve(".mete/mcp.yaml").path.fsPath();

const fakeFiles = (initial: Record<string, string>) => {
	const disk = new Map(Object.entries(initial));
	const files = {
		exists: async (u: URI) => disk.has(u.path.fsPath()),
		read: async (u: URI) => ({ value: disk.get(u.path.fsPath()) ?? "" }),
		write: async (u: URI, text: string) => void disk.set(u.path.fsPath(), text),
		delete: async (u: URI) => void disk.delete(u.path.fsPath()),
	} as unknown as FileService;
	return { files, disk };
};

const formOver = async (initial: Record<string, string>) => {
	const { files, disk } = fakeFiles(initial);
	const form = new McpForm(files, () => {});
	await form.load(WORK, GLOBAL);
	return { form, disk };
};

const stateOf = (form: McpForm) => form.form()?.state;
const actionsOf = (form: McpForm) => form.form()?.actions;

const BLENDER =
	"servers:\n  - id: blender\n    transport: stdio\n    runtime: python\n    command: uvx\n";

describe("the MCP servers card's file", () => {
	it.each([
		["io", false],
		["io", true],
		["invalid", false],
		["invalid", true],
	] as const)(
		"blocks an unread global scope after %s failure (dirty=%s)",
		async (failure, dirty) => {
			const global =
				"mcp:\n  servers:\n    - id: global-b\n      transport: sse\n      url: https://b.test\n";
			const { files, disk } = fakeFiles({
				[WORK_KEY]: BLENDER,
				[GLOBAL_KEY]: global,
			});
			let fail = true;
			const form = new McpForm(
				{
					...files,
					read: async (uri: URI) => {
						if (fail && uri.path.fsPath() === GLOBAL_KEY) {
							if (failure === "io") throw new Error("unreadable");
							return { value: "mcp: { servers: invalid }\n" };
						}
						return { value: disk.get(uri.path.fsPath()) ?? "" };
					},
				} as unknown as FileService,
				() => {},
			);
			await form.load(WORK, GLOBAL);
			if (dirty) actionsOf(form)?.onField(0, "args", "keep me");
			const typed = stateOf(form)?.servers;
			await form.retarget("global");
			expect(stateOf(form)).toMatchObject({
				target: "global",
				unread: true,
				dirty,
				busy: false,
			});
			expect(stateOf(form)?.servers).toEqual(dirty ? typed : []);
			const blocked = stateOf(form);
			actionsOf(form)?.onField(0, "id", "overwritten");
			actionsOf(form)?.onAdd();
			actionsOf(form)?.onRemove(0);
			expect(
				form.addDraft({
					id: "new",
					transport: "sse",
					url: "https://new.test",
				}),
			).toBe(false);
			expect(await form.save()).toBe(false);
			expect(stateOf(form)).toBe(blocked);
			expect(disk.get(GLOBAL_KEY)).toBe(global);
			fail = false;
			await form.load(WORK, GLOBAL);
			expect(stateOf(form)?.unread).toBe(false);
			expect(stateOf(form)?.servers).toEqual(
				dirty
					? typed
					: expect.arrayContaining([
							expect.objectContaining({ id: "global-b" }),
						]),
			);
		},
	);

	it("does not turn an initial read failure into an empty draft on retry", async () => {
		const { files } = fakeFiles({ [WORK_KEY]: BLENDER });
		let refused = true;
		const form = new McpForm(
			{
				...files,
				read: async () => {
					if (refused) throw new Error("disk unavailable");
					return { value: BLENDER };
				},
			} as unknown as FileService,
			() => {},
		);
		await form.load(WORK, GLOBAL);
		expect(stateOf(form)?.dirty).toBe(false);
		refused = false;
		await form.load(WORK, GLOBAL);
		expect(stateOf(form)?.servers[0]?.id).toBe("blender");
	});

	it("keeps an edited draft and auth across refresh and rapid scope changes", async () => {
		const { form, disk } = await formOver({ [WORK_KEY]: BLENDER });
		actionsOf(form)?.onField(0, "args", "edited");
		actionsOf(form)?.onField(0, "auth", "oauth");
		await form.load(WORK, GLOBAL);
		expect(stateOf(form)?.servers[0]?.args).toBe("edited");
		expect(stateOf(form)?.dirty).toBe(true);
		await Promise.all([form.retarget("global"), form.load(WORK, GLOBAL)]);
		expect(stateOf(form)?.target).toBe("global");
		expect(stateOf(form)?.servers[0]?.auth).toBe("oauth");
		expect(stateOf(form)?.servers[0]?.args).toBe("edited");
		expect(disk.get(WORK_KEY)).toBe(BLENDER);
	});

	it("retains input after disk read and write failures and allows retry", async () => {
		const { files, disk } = fakeFiles({ [WORK_KEY]: BLENDER });
		let readRefused = false;
		let writeRefused = false;
		const form = new McpForm(
			{
				...files,
				read: async () => {
					if (readRefused) throw new Error("disk unavailable");
					return { value: disk.get(WORK_KEY) ?? "" };
				},
				write: async (uri: URI, text: string) => {
					if (writeRefused) throw new Error("disk unavailable");
					disk.set(uri.path.fsPath(), text);
				},
			} as unknown as FileService,
			() => {},
		);
		await form.load(WORK, GLOBAL);
		actionsOf(form)?.onField(0, "args", "edited");
		readRefused = true;
		await form.load(WORK, GLOBAL);
		expect(stateOf(form)?.busy).toBe(false);
		expect(stateOf(form)?.note?.kind).toBe("refused");
		expect(stateOf(form)?.servers[0]?.args).toBe("edited");
		readRefused = false;
		expect(await form.save()).toBe(false);
		await form.load(WORK, GLOBAL);
		writeRefused = true;
		expect(await form.save()).toBe(false);
		expect(stateOf(form)?.dirty).toBe(true);
		writeRefused = false;
		expect(await form.save()).toBe(true);
		expect(parse(disk.get(WORK_KEY) ?? "").servers[0].args).toEqual(["edited"]);
	});

	it("refuses unsupported retained server fields without rewriting the file", async () => {
		const source =
			"servers:\n  - id: demo\n    transport: sse\n    url: https://example.test\n    headers: { Authorization: secret }\n";
		const { form, disk } = await formOver({ [WORK_KEY]: source });
		actionsOf(form)?.onField(0, "url", "https://changed.test");
		expect(await form.save()).toBe(false);
		expect(disk.get(WORK_KEY)).toBe(source);
		expect(stateOf(form)?.dirty).toBe(true);
		expect(stateOf(form)?.note?.kind).toBe("refused");
	});

	it("ignores an older file read after another workspace loads", async () => {
		const slow = URI.fromFilePath("/slow");
		const slowKey = slow.resolve(".mete/mcp.yaml").path.fsPath();
		const { files } = fakeFiles({
			[slowKey]: BLENDER,
			[WORK_KEY]: "servers: []\n",
		});
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const form = new McpForm(
			{
				...files,
				read: async (uri: URI) => {
					if (uri.path.fsPath() === slowKey) await held;
					return {
						value: uri.path.fsPath() === slowKey ? BLENDER : "servers: []\n",
					};
				},
			} as unknown as FileService,
			() => {},
		);
		const older = form.load(slow, GLOBAL);
		await form.load(WORK, GLOBAL);
		release();
		await older;
		expect(stateOf(form)?.file).toBe(WORK_KEY);
		expect(stateOf(form)?.servers).toEqual([]);
	});

	it("does not activate or replace the new workspace state after an old save finishes", async () => {
		const { files } = fakeFiles({ [WORK_KEY]: BLENDER });
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const form = new McpForm(
			{
				...files,
				write: async () => {
					await held;
				},
			} as unknown as FileService,
			() => {},
		);
		await form.load(WORK, GLOBAL);
		actionsOf(form)?.onField(0, "args", "new");
		const saving = form.save();
		await form.load(URI.fromFilePath("/other"), GLOBAL);
		release();
		expect(await saving).toBe(false);
		expect(stateOf(form)?.servers).toEqual([]);
		expect(stateOf(form)?.note).toBeUndefined();
	});

	it("rejects malformed or lossy catalog rows without changing the state", async () => {
		const { form } = await formOver({});
		const before = stateOf(form);
		for (const args of [[""], ["one\ntwo"]]) {
			expect(
				form.addDraft({
					id: "demo",
					transport: "stdio",
					runtime: "node",
					command: "npx",
					args,
				}),
			).toBe(false);
		}
		expect(
			form.addDraft({
				id: "demo",
				transport: "sse",
				url: "https://example.test",
				headers: {},
			}),
		).toBe(false);
		expect(stateOf(form)).toBe(before);
	});

	it("adds validated drafts atomically, rejects duplicates, and exposes the latest prepared row", async () => {
		const { form, disk } = await formOver({ [WORK_KEY]: BLENDER });
		const row = {
			...EMPTY_MCP_SERVER,
			id: "remote",
			transport: "sse",
			url: "https://example.test",
		};
		expect(form.addDraft([row])).toBe(true);
		expect(form.form()?.state.prepared).toEqual(row);
		const before = stateOf(form);
		expect(form.addDraft([row])).toBe(false);
		expect(stateOf(form)).toBe(before);
		expect(
			form.addDraft([
				{ ...row, id: "other" },
				{ ...row, id: "" },
			]),
		).toBe(false);
		expect(stateOf(form)).toBe(before);
		expect(disk.get(WORK_KEY)).toBe(BLENDER);
		expect(await form.save()).toBe(true);
	});

	it("accepts a schema-validated catalog server without starting it", async () => {
		const { form, disk } = await formOver({});
		expect(
			form.addDraft({
				id: "catalog",
				transport: "stdio",
				runtime: "node",
				command: "npx",
				args: ["pkg@1"],
			}),
		).toBe(true);
		expect(stateOf(form)?.prepared?.id).toBe("catalog");
		expect(disk.has(WORK_KEY)).toBe(false);
		actionsOf(form)?.onField(0, "command", "");
		expect(await form.save()).toBe(false);
		expect(stateOf(form)?.dirty).toBe(true);
	});

	it("reads this folder's servers and saves what the user typed", async () => {
		const { form, disk } = await formOver({ [WORK_KEY]: BLENDER });
		expect(stateOf(form)?.servers).toHaveLength(1);
		expect(stateOf(form)?.servers[0]).toMatchObject({
			id: "blender",
			transport: "stdio",
			runtime: "python",
			command: "uvx",
		});
		actionsOf(form)?.onField(0, "args", "blender-mcp==1.2.0");
		actionsOf(form)?.onPermission(0, "fs.read", true);
		expect(stateOf(form)?.dirty).toBe(true);
		await form.save();
		const [written] = parse(disk.get(WORK_KEY) ?? "").servers;
		expect(written).toMatchObject({
			id: "blender",
			args: ["blender-mcp==1.2.0"],
			permissions: ["fs.read"],
		});
		expect(stateOf(form)?.dirty).toBe(false);
		expect(stateOf(form)?.note?.kind).toBe("saved");
	});

	it("keeps what was typed when the scope switch moves it to all folders", async () => {
		const { form, disk } = await formOver({
			[GLOBAL_KEY]: "gateway:\n  models: free\n",
		});
		actionsOf(form)?.onAdd();
		actionsOf(form)?.onField(0, "id", "hf-spaces");
		actionsOf(form)?.onField(0, "transport", "streamable-http");
		actionsOf(form)?.onField(0, "url", "https://huggingface.co/mcp");
		actionsOf(form)?.onField(0, "auth", "oauth");
		await form.retarget("global");
		expect(stateOf(form)?.target).toBe("global");
		expect(stateOf(form)?.servers[0]?.id).toBe("hf-spaces");
		expect(stateOf(form)?.dirty).toBe(true);
		await form.save();
		expect(parse(disk.get(GLOBAL_KEY) ?? "")).toEqual({
			gateway: { models: "free" },
			mcp: {
				servers: [
					{
						id: "hf-spaces",
						transport: "streamable-http",
						url: "https://huggingface.co/mcp",
						auth: "oauth",
					},
				],
			},
		});
		expect(disk.has(WORK_KEY)).toBe(false);
	});

	it("writes nothing and keeps the card changed when a server is refused", async () => {
		const { form, disk } = await formOver({ [WORK_KEY]: BLENDER });
		actionsOf(form)?.onField(0, "id", "Blender");
		await form.save();
		expect(disk.get(WORK_KEY)).toBe(BLENDER);
		expect(stateOf(form)?.note?.kind).toBe("refused");
		expect(stateOf(form)?.dirty).toBe(true);
	});

	it("deletes the folder's file when the last server goes, so it stays no empty layer", async () => {
		const { form, disk } = await formOver({ [WORK_KEY]: BLENDER });
		actionsOf(form)?.onRemove(0);
		await form.save();
		expect(disk.has(WORK_KEY)).toBe(false);
		expect(stateOf(form)?.servers).toEqual([]);
		expect(stateOf(form)?.note?.kind).toBe("saved");
	});

	it("says why when the file is not valid YAML, and writes nothing", async () => {
		const { form, disk } = await formOver({ [WORK_KEY]: "servers: [\n" });
		expect(stateOf(form)?.note?.kind).toBe("refused");
		actionsOf(form)?.onAdd();
		await form.save();
		expect(disk.get(WORK_KEY)).toBe("servers: [\n");
	});
});
