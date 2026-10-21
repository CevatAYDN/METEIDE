import { describe, expect, it } from "vitest";
import {
	editText,
	isBinary,
	lineEnding,
	sliceLines,
	streamCollector,
} from "../../src/domain/text.js";

describe("lineEnding", () => {
	it("tells lf, crlf, mixed and none apart", () => {
		expect(lineEnding("a\nb\n")).toBe("lf");
		expect(lineEnding("a\r\nb\r\n")).toBe("crlf");
		expect(lineEnding("a\r\nb\n")).toBe("mixed");
		expect(lineEnding("a")).toBe("none");
	});
});

describe("isBinary", () => {
	it("looks for a NUL byte in the first 8 KB only", () => {
		expect(isBinary(new Uint8Array([97, 0, 98]))).toBe(true);
		expect(isBinary(new Uint8Array([97, 98]))).toBe(false);
		const late = new Uint8Array(8 * 1024 + 1).fill(97);
		late[8 * 1024] = 0;
		expect(isBinary(late)).toBe(false);
	});
});

describe("sliceLines", () => {
	it("counts a last line without a break and keeps each line's break", () => {
		expect(sliceLines("a\nb\nc")).toEqual({
			content: "a\nb\nc",
			totalLines: 3,
		});
		expect(sliceLines("a\r\nb\r\n", 2)).toEqual({
			content: "b\r\n",
			totalLines: 2,
		});
		expect(sliceLines("a\nb\n", 1, 1)).toEqual({
			content: "a\n",
			totalLines: 2,
		});
		expect(sliceLines("")).toEqual({ content: "", totalLines: 0 });
	});
});

describe("editText", () => {
	it("replaces one exact match and reports other counts", () => {
		expect(editText("a b a", { oldStr: "b", newStr: "c" })).toEqual({
			text: "a c a",
			replacements: 1,
		});
		expect(editText("a b a", { oldStr: "a", newStr: "c" })).toEqual({
			count: 2,
		});
		expect(editText("a", { oldStr: "z", newStr: "c" })).toEqual({ count: 0 });
		expect(
			editText("a b a", { oldStr: "a", newStr: "$&", replaceAll: true }),
		).toEqual({ text: "$& b $&", replacements: 2 });
	});

	it("matches LF in a CRLF file and writes CRLF back; mixed files stay raw", () => {
		expect(editText("x\r\ny\r\n", { oldStr: "x\ny", newStr: "p\nq" })).toEqual({
			text: "p\r\nq\r\n",
			replacements: 1,
		});
		expect(editText("x\r\ny\n", { oldStr: "x\ny", newStr: "z" })).toEqual({
			count: 0,
		});
	});
});

describe("streamCollector", () => {
	const collect = (chunks: string[], max: number) => {
		const c = streamCollector(max);
		for (const chunk of chunks) c.push(chunk);
		return c.text();
	};

	it("keeps a short stream whole, across any chunking", () => {
		expect(collect(["ab", "c", "d"], 4)).toBe("abcd");
		expect(collect(["", "abc"], 4)).toBe("abc");
	});

	it("keeps the head and tail halves of a long stream and names the cut", () => {
		const cut = "ab\n[3 characters cut]\nfg";
		expect(collect(["abcdefg"], 4)).toBe(cut);
		expect(collect(["a", "bcd", "ef", "g"], 4)).toBe(cut);
		expect(collect(["abcde"], 5)).toBe("abcde");
		expect(collect(["abcdefg"], 5)).toBe(cut);
	});
});
