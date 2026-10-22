import { describe, expect, it } from "vitest";
import { unpackCommand } from "../src/infrastructure/runtime-system.js";

describe("unpacking an archive", () => {
	it("hands a zip bundle to unzip on Linux, because GNU tar reads no zip", () => {
		expect(unpackCommand("linux", "/c/tool.zip", "/out")).toEqual([
			"unzip",
			["-q", "/c/tool.zip", "-d", "/out"],
		]);
		expect(unpackCommand("linux", "/c/tool.MCPB", "/out")[0]).toBe("unzip");
	});

	it("keeps tar for tarballs on Linux and for every archive elsewhere", () => {
		expect(unpackCommand("linux", "/c/node.tar.gz", "/out")[1]).toEqual([
			"-xf",
			"/c/node.tar.gz",
			"-C",
			"/out",
		]);
		expect(unpackCommand("win32", "C:c\tool.zip", "C:out")[1]).toEqual([
			"-xf",
			"C:c\tool.zip",
			"-C",
			"C:out",
		]);
		expect(unpackCommand("darwin", "/c/tool.zip", "/out")[0]).not.toBe("unzip");
	});
});
