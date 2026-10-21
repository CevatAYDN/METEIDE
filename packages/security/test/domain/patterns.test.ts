import { describe, expect, it } from "vitest";
import {
	commandMatches,
	commandParts,
	hasShellOperator,
	isInside,
	normalizePath,
	type PathEnv,
	pathMatches,
} from "../../src/domain/patterns.js";

const posix: PathEnv = {
	platform: "linux",
	home: "/home/u",
	workspaceDir: "/repo",
};
const win: PathEnv = {
	platform: "win32",
	home: "C:\\Users\\U",
	workspaceDir: "C:\\Repo",
};

describe("commandMatches", () => {
	it("lets * cross slashes and anchors the whole command", () => {
		expect(commandMatches("rm -rf /*", "rm -rf /home/x")).toBe(true);
		expect(commandMatches("rm -rf /*", "rm -rf /")).toBe(true);
		expect(commandMatches("git diff *", "git diff src/a.ts")).toBe(true);
		expect(commandMatches("git status", "git status && rm -rf /")).toBe(false);
		expect(commandMatches("npm test", "npm test2")).toBe(false);
	});

	it("trims and collapses spaces on both sides", () => {
		expect(commandMatches("rm -rf /*", "  rm   -rf\t/etc ")).toBe(true);
	});

	it("treats regex characters in patterns literally", () => {
		expect(commandMatches("echo (a|b)", "echo (a|b)")).toBe(true);
		expect(commandMatches("echo a.b", "echo axb")).toBe(false);
		expect(commandMatches("ls ?", "ls x")).toBe(false);
	});
});

describe("hasShellOperator", () => {
	it("flags chaining, pipes, redirects, substitution and grouping, even quoted", () => {
		for (const c of [
			"pnpm i && rm -rf ~",
			"pnpm i || x",
			"pnpm i; x",
			"pnpm i & x",
			"pnpm i | sh",
			"pnpm i\nx",
			"pnpm i\rx",
			"pnpm `x`",
			"pnpm $(x)",
			"pnpm (Remove-Item ~)",
			"pnpm test > ~/.bashrc",
			"pnpm test < in",
			'git diff "a|b"',
		])
			expect(hasShellOperator(c), c).toBe(true);
		expect(hasShellOperator("pnpm install --filter @mete/kernel")).toBe(false);
	});
});

describe("commandParts", () => {
	it("splits at operators and opens substitutions and groups", () => {
		expect(commandParts("echo x && rm -rf /")).toEqual(["echo x", "rm -rf /"]);
		expect(commandParts("a||b;c&d|e\nf\rg")).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
			"f",
			"g",
		]);
		expect(commandParts("echo $(rm -rf /) `rm -rf /x`")).toEqual([
			"echo $",
			"rm -rf /",
			"rm -rf /x",
		]);
		expect(commandParts("  git   status ")).toEqual(["git status"]);
	});
});

describe("pathMatches", () => {
	it("keeps * and ? inside one folder and lets ** cross folders", () => {
		expect(pathMatches("/a/*", "/a/b", posix)).toBe(true);
		expect(pathMatches("/a/*", "/a/b/c", posix)).toBe(false);
		expect(pathMatches("/a/?.txt", "/a/x.txt", posix)).toBe(true);
		expect(pathMatches("/a/**/z", "/a/z", posix)).toBe(true);
		expect(pathMatches("/a/**/z", "/a/b/c/z", posix)).toBe(true);
	});

	it("matches dot files and the folder itself under dir/**", () => {
		expect(pathMatches("~/.ssh/**", "/home/u/.ssh/.hidden", posix)).toBe(true);
		expect(pathMatches("~/.ssh/**", "/home/u/.ssh", posix)).toBe(true);
		expect(pathMatches("~/.ssh/**", "/home/u/.sshx", posix)).toBe(false);
	});

	it("resolves relative patterns and paths against the workspace", () => {
		expect(pathMatches("secrets/**", "/repo/secrets/key", posix)).toBe(true);
		expect(pathMatches("secrets/**", "/repo/../secrets/key", posix)).toBe(
			false,
		);
		expect(pathMatches("/repo/a/**", "/repo/a/../../etc/passwd", posix)).toBe(
			false,
		);
	});

	it("ignores case and separators on Windows only", () => {
		expect(pathMatches("~/.ssh/**", "c:\\users\\u\\.SSH\\id_rsa", win)).toBe(
			true,
		);
		expect(pathMatches("C:/Repo/**", "c:\\repo\\x", win)).toBe(true);
		expect(pathMatches("/home/u/a/**", "/home/U/a/x", posix)).toBe(false);
	});
});

describe("isInside", () => {
	it("accepts the folder and its children, not a sibling prefix", () => {
		const repo = normalizePath("/repo", posix);
		expect(isInside(repo, normalizePath("/repo", posix))).toBe(true);
		expect(isInside(repo, normalizePath("/repo/a/b", posix))).toBe(true);
		expect(isInside(repo, normalizePath("/repo2/a", posix))).toBe(false);
		expect(isInside(repo, normalizePath("/repo/../etc", posix))).toBe(false);
	});
});
