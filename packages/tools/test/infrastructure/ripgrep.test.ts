import { afterEach, describe, expect, it } from "vitest";
import { grepLines, listFiles } from "../../src/infrastructure/ripgrep.js";
import { tempWorkspace } from "./workspace.js";

let ws: Awaited<ReturnType<typeof tempWorkspace>>;
afterEach(() => ws.close());

const signal = new AbortController().signal;
const all = () => true;

const fill = async () => {
	ws = await tempWorkspace();
	await ws.put("src/a.ts", "Needle one\nneedle two\n");
	await ws.put("src/b.md", "needle\n");
	await ws.put(".github/ci.yml", "needle\n");
	await ws.put(".gitignore", "dist/\n");
	await ws.put("dist/out.ts", "needle\n");
	await ws.put(".git/config", "needle\n");
};

describe("listFiles", () => {
	it("lists hidden files, honors .gitignore without a repository and skips .git", async () => {
		await fill();
		const r = await listFiles(ws.workspaceDir, {}, signal, all);
		expect(r).toEqual({
			ok: true,
			value: [".github/ci.yml", ".gitignore", "src/a.ts", "src/b.md"],
		});
	});

	it("narrows to a folder and a glob and drops what keep refuses", async () => {
		await fill();
		const r = await listFiles(
			ws.workspaceDir,
			{ sub: "src", glob: "*.ts" },
			signal,
			all,
		);
		expect(r).toEqual({ ok: true, value: ["src/a.ts"] });
		const kept = await listFiles(ws.workspaceDir, {}, signal, (p) =>
			p.startsWith("src/"),
		);
		expect(kept).toEqual({ ok: true, value: ["src/a.ts", "src/b.md"] });
	});
});

describe("grepLines", () => {
	const grep = (over: Partial<Parameters<typeof grepLines>[1]> = {}) =>
		grepLines(
			ws.workspaceDir,
			{ pattern: "needle", caseSensitive: true, max: 200, ...over },
			signal,
			all,
		);

	it("finds lines in path order with their line numbers", async () => {
		await fill();
		const r = await grep();
		expect(r).toEqual({
			ok: true,
			value: {
				matches: [
					{ path: ".github/ci.yml", line: 1, text: "needle" },
					{ path: "src/a.ts", line: 2, text: "needle two" },
					{ path: "src/b.md", line: 1, text: "needle" },
				],
				truncated: false,
			},
		});
	});

	it("ignores case on request and cuts at max", async () => {
		await fill();
		const r = await grep({ caseSensitive: false, glob: "*.ts", max: 1 });
		expect(r).toEqual({
			ok: true,
			value: {
				matches: [{ path: "src/a.ts", line: 1, text: "Needle one" }],
				truncated: true,
			},
		});
	});

	it("reports a bad pattern as bad_input", async () => {
		await fill();
		const r = await grep({ pattern: "(" });
		expect(r.ok ? undefined : r.error.code).toBe("bad_input");
	});
});
