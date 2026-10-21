import type {
	FsEditInput,
	FsEditOutput,
	FsGlobInput,
	FsGrepInput,
	FsGrepOutput,
	FsListInput,
	FsPathsOutput,
	FsReadInput,
	FsReadOutput,
	FsWriteInput,
	FsWriteOutput,
	PolicyVerdict,
	Result,
	ToolAdapter,
	ToolError,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for fs.*@1 (docs/06 tool types, docs/10 Built-in tools).

/** The six fs.*@1 adapters of one workspace. */
export type FsTools = {
	readonly read: ToolAdapter<FsReadInput, FsReadOutput>;
	readonly write: ToolAdapter<FsWriteInput, FsWriteOutput>;
	readonly edit: ToolAdapter<FsEditInput, FsEditOutput>;
	readonly list: ToolAdapter<FsListInput, FsPathsOutput>;
	readonly glob: ToolAdapter<FsGlobInput, FsPathsOutput>;
	readonly grep: ToolAdapter<FsGrepInput, FsGrepOutput>;
};

/** Opens the tools on an empty workspace whose policy.check@1 always answers `verdict`. */
export type FsToolsHarness = (verdict: PolicyVerdict["verdict"]) => Promise<{
	readonly tools: FsTools;
	readonly close: () => Promise<void>;
}>;

const ctx = { signal: new AbortController().signal };

const value = <T>(r: Result<T, ToolError>): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

const code = <T>(r: Result<T, ToolError>) => (r.ok ? "ok" : r.error.code);

/** Every set of fs.*@1 adapters MUST pass these tests. */
export const fsToolsContract = (name: string, open: FsToolsHarness) =>
	describe(`fs.*@1 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const tools = async (verdict: PolicyVerdict["verdict"] = "allow") => {
			const h = await open(verdict);
			close = h.close;
			return h.tools;
		};
		const put = (t: FsTools, path: string, content: string) =>
			t.write.run({ path, content }, ctx).then(value);

		it("writes, reads a line range and reports the line ending", async () => {
			const t = await tools();
			expect(await put(t, "a.txt", "one\ntwo\nthree\n")).toEqual({ bytes: 14 });
			expect(
				value(
					await t.read.run({ path: "a.txt", startLine: 2, endLine: 2 }, ctx),
				),
			).toEqual({ content: "two\n", totalLines: 3, lineEnding: "lf" });
			expect(code(await t.read.run({ path: "nope.txt" }, ctx))).toBe(
				"not_found",
			);
			expect(code(await t.read.run({ path: "../x.txt" }, ctx))).toBe(
				"outside_workspace",
			);
		});

		it("refuses createOnly on an existing file and deletes", async () => {
			const t = await tools();
			await put(t, "a.txt", "x");
			const again = { path: "a.txt", content: "y", createOnly: true };
			expect(code(await t.write.run(again, ctx))).toBe("exists");
			expect(
				value(await t.write.run({ path: "a.txt", delete: true }, ctx)),
			).toEqual({ bytes: 0 });
			expect(code(await t.read.run({ path: "a.txt" }, ctx))).toBe("not_found");
		});

		it("edits one exact match, counts others and keeps CRLF", async () => {
			const t = await tools();
			await put(t, "a.txt", "a\r\nb\r\nb\r\n");
			const edit = (oldStr: string, replaceAll?: boolean) =>
				t.edit.run({ path: "a.txt", oldStr, newStr: "c\nd", replaceAll }, ctx);
			const twice = await edit("b");
			expect(twice.ok ? 0 : twice.error).toMatchObject({
				code: "match_count",
				count: 2,
			});
			expect(code(await edit("zzz"))).toBe("match_count");
			expect(value(await edit("a\nb"))).toEqual({ replacements: 1 });
			expect(value(await t.read.run({ path: "a.txt" }, ctx))).toEqual({
				content: "c\r\nd\r\nb\r\n",
				totalLines: 3,
				lineEnding: "crlf",
			});
		});

		it("refuses binary files", async () => {
			const t = await tools();
			await put(t, "b.bin", "a\u0000b");
			expect(code(await t.read.run({ path: "b.bin" }, ctx))).toBe("binary");
		});

		it("lists, globs and greps, leaving out .meteignore defaults", async () => {
			const t = await tools();
			await put(t, "src/a.ts", "const needle = 1;\n");
			await put(t, "b.md", "needle\n");
			await put(t, ".env", "needle=secret\n");
			expect(value(await t.list.run({ path: "." }, ctx)).paths).toEqual([
				"b.md",
				"src/",
			]);
			expect(
				value(await t.glob.run({ pattern: "**/*.ts" }, ctx)).paths,
			).toEqual(["src/a.ts"]);
			const found = value(await t.grep.run({ pattern: "needle" }, ctx));
			expect(found.matches.map((m) => [m.path, m.line])).toEqual([
				["b.md", 1],
				["src/a.ts", 1],
			]);
			expect(found.truncated).toBe(false);
			expect(code(await t.read.run({ path: ".env" }, ctx))).toBe("ignored");
			expect(
				code(await t.edit.run({ path: ".env", oldStr: "n", newStr: "m" }, ctx)),
			).toBe("ignored");
		});

		it("cuts grep results at maxResults", async () => {
			const t = await tools();
			await put(t, "a.txt", "x\nx\nx\n");
			const r = value(await t.grep.run({ pattern: "x", maxResults: 2 }, ctx));
			expect(r.matches).toHaveLength(2);
			expect(r.truncated).toBe(true);
		});

		it("returns the policy's deny and ask without writing", async () => {
			for (const [verdict, want] of [
				["deny", "denied"],
				["ask", "approval_required"],
			] as const) {
				const t = await tools(verdict);
				const r = await t.write.run({ path: "a.txt", content: "x" }, ctx);
				expect(r.ok ? undefined : r.error).toMatchObject({ code: want });
				expect(r.ok || ("rule" in r.error && r.error.rule.length > 0)).toBe(
					true,
				);
				expect(code(await t.read.run({ path: "a.txt" }, ctx))).toBe(
					"not_found",
				);
				await close?.();
				close = undefined;
			}
		});
	});
