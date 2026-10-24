import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
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
