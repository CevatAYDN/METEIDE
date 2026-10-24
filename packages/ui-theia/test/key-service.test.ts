import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseKeyList } from "../src/domain/provider-keys.js";
import { createKeyService } from "../src/infrastructure/key-service.js";
import { runScript } from "../src/infrastructure/spawn-cli.js";

// The key service runs a fake `mete key` in a real Node child, so the arguments and the standard
// input are the ones the real command would get; no keychain is touched.

const SCRIPT = `
const fs = require("node:fs");
const [, , record, , , action, id] = process.argv; // node, script, record, "--", "key", action, id
if (action === "list") {
	process.stdout.write("nvidia         key set  model   https://n.example/keys\\ntavily         no key   search  https://t.example\\n");
	process.exit(0);
}
if (id === "bad") {
	process.stderr.write("usage: mete key set|delete <provider id>\\n");
	process.exit(1);
}
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
	fs.writeFileSync(record, JSON.stringify({ action, id, input }));
	process.stdout.write(id + " key saved in the keychain\\n");
});
`;

let root: string | undefined;
afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

const setup = async () => {
	root = await mkdtemp(join(tmpdir(), "mete-fake-key-"));
	const script = join(root, "key.cjs");
	const record = join(root, "record.json");
	await writeFile(script, SCRIPT);
	let restarts = 0;
	const keys = createKeyService({
		// The record path rides first, so the fake knows where to write what it got.
		run: (args, input) => runScript(script, [record, "--", ...args], input),
		restart: async () => {
			restarts += 1;
		},
	});
	return { keys, record, restarts: () => restarts };
};

describe("provider keys through mete key", () => {
	it("lists the providers mete key list names, with their key state, kind and key page", async () => {
		const { keys } = await setup();
		expect(await keys.keys()).toEqual({
			ok: true,
			value: [
				{
					id: "nvidia",
					set: true,
					kind: "model",
					keyPage: "https://n.example/keys",
				},
				{
					id: "tavily",
					set: false,
					kind: "search",
					keyPage: "https://t.example",
				},
			],
		});
	});

	it("sends the key on standard input only, then restarts the daemon", async () => {
		const { keys, record, restarts } = await setup();
		expect(await keys.setKey("groq", "gsk_secret")).toEqual({
			ok: true,
			value: null,
		});
		const got = JSON.parse(await readFile(record, "utf8"));
		expect(got).toEqual({ action: "set", id: "groq", input: "gsk_secret\n" });
		expect(restarts()).toBe(1);
	});

	it("shows what the command said when it refuses, and does not restart", async () => {
		const { keys, restarts } = await setup();
		expect(await keys.setKey("bad", "k")).toEqual({
			ok: false,
			error: {
				code: "cli",
				detail: "usage: mete key set|delete <provider id>",
			},
		});
		expect(restarts()).toBe(0);
	});

	it("does not take output that is not mete key list's", () => {
		expect(parseKeyList("nvidia key set model https://n.example\n\n")).toEqual([
			{ id: "nvidia", set: true, kind: "model", keyPage: "https://n.example" },
		]);
		expect(parseKeyList("Error: keychain locked")).toBeUndefined();
		// The page opens in the system browser, so only an https address is taken.
		expect(parseKeyList("nvidia key set model file:///etc")).toBeUndefined();
		expect(parseKeyList("nvidia key set")).toBeUndefined();
	});
});
