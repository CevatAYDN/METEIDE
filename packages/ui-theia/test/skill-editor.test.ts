import { err, ok } from "@mete/contracts";
import URI from "@theia/core/lib/common/uri";
import { expect, it, vi } from "vitest";
import { openSkillEditor } from "../src/infrastructure/skill-editor.js";

const source = {
	sourceId: "a".repeat(64),
	scope: "workspace" as const,
	path: "review-fixture/SKILL.md",
};
const directory = { isFile: false, isDirectory: true, isSymbolicLink: false };
const file = { isFile: true, isDirectory: false, isSymbolicLink: false };
const unavailable = err({ code: "unavailable" as const });
const workspace = URI.fromFilePath("/workspace");
const globalFile = "file:///global/settings.yaml";
const workspacePaths = [
	"file:///workspace",
	"file:///workspace/.mete",
	"file:///workspace/.mete/skills",
	"file:///workspace/.mete/skills/review-fixture",
	"file:///workspace/.mete/skills/review-fixture/SKILL.md",
];
const globalPaths = [
	"file:///global",
	"file:///global/skills",
	"file:///global/skills/review-fixture",
	"file:///global/skills/review-fixture/SKILL.md",
];

const setup = (scope: "workspace" | "global" = "workspace") => {
	let current = true;
	const paths = scope === "workspace" ? workspacePaths : globalPaths;
	const metadata = new Map<string, unknown>(
		paths.map((path, index) => [
			path,
			index === paths.length - 1 ? file : directory,
		]),
	);
	const resolve = vi.fn(
		async (uri: URI): Promise<unknown> => metadata.get(uri.toString()),
	);
	const open = vi.fn(async (_uri: URI): Promise<unknown> => null);
	return {
		paths,
		metadata,
		resolve,
		open,
		retire: () => {
			current = false;
		},
		options: {
			source: { ...source, scope },
			workspace,
			globalFile,
			current: () => current,
			resolve,
			open,
		},
	};
};

it.each(["workspace", "global"] as const)(
	"checks the exact %s chain before opening only its SKILL.md",
	async (scope) => {
		const s = setup(scope);
		expect(s.resolve).not.toHaveBeenCalled();
		expect(s.open).not.toHaveBeenCalled();
		s.open.mockImplementation(async () => {
			expect(s.resolve.mock.calls.map(([uri]) => uri.toString())).toEqual(
				s.paths,
			);
			return null;
		});
		expect(await openSkillEditor(s.options)).toEqual(ok(null));
		expect(s.open).toHaveBeenCalledTimes(1);
		expect(s.open.mock.calls[0]?.[0].toString()).toBe(s.paths.at(-1));
	},
);

it.each([
	...[
		"../SKILL.md",
		"./SKILL.md",
		"/absolute/SKILL.md",
		"nested/child/SKILL.md",
		"C:\\outside\\SKILL.md",
		"C:outside/SKILL.md",
		"bad\u0000/SKILL.md",
		"con/SKILL.md",
		"trailing./SKILL.md",
		"x/skill.md",
	].map((path) => ({ ...source, path })),
	null,
	{},
	{ ...source, sourceId: "../outside" },
	{ ...source, scope: "other" },
	{ ...source, extra: true },
])("rejects malformed descriptor %# without I/O", async (raw) => {
	const s = setup();
	expect(await openSkillEditor({ ...s.options, source: raw })).toEqual(
		err({ code: "bad_input" }),
	);
	expect(s.resolve).not.toHaveBeenCalled();
	expect(s.open).not.toHaveBeenCalled();
});

it.each([
	"",
	"settings.yaml",
	"/global/settings.yaml",
	"C:\\global\\settings.yaml",
	"file:settings.yaml",
	"https://host/settings.yaml",
	"file:///global/policy.yaml",
	"file:///global/settings.yaml/",
	"file:///global/settings.yaml?other",
	"file:///global/settings.yaml#other",
])("refuses an invalid authoritative global file %s", async (target) => {
	const s = setup("global");
	const result = await openSkillEditor({ ...s.options, globalFile: target });
	expect(result).toEqual(unavailable);
	expect(s.resolve).not.toHaveBeenCalled();
	expect(s.open).not.toHaveBeenCalled();
});

it("refuses unconfigured global roots and non-file workspace URIs", async () => {
	const s = setup("global");
	const { globalFile: _globalFile, ...unconfigured } = s.options;
	expect(await openSkillEditor(unconfigured)).toEqual(unavailable);
	expect(
		await openSkillEditor({
			...s.options,
			workspace: new URI("https://host/workspace"),
		}),
	).toEqual(err({ code: "bad_input" }));
	expect(s.resolve).not.toHaveBeenCalled();
	expect(s.open).not.toHaveBeenCalled();
});

it.each(["workspace", "global"] as const)(
	"rejects links, wrong kinds and unknown metadata at every %s stage",
	async (scope) => {
		for (const path of setup(scope).paths) {
			const s = setup(scope);
			const kind = path === s.paths.at(-1) ? file : directory;
			for (const raw of [
				undefined,
				null,
				{},
				{ ...kind, isSymbolicLink: true },
				{ ...kind, isSymbolicLink: undefined },
				{ ...kind, isDirectory: "true" },
				{ isFile: false, isDirectory: false, isSymbolicLink: false },
				{ isFile: true, isDirectory: true, isSymbolicLink: false },
				path === s.paths.at(-1) ? directory : file,
			]) {
				s.metadata.set(path, raw);
				expect(await openSkillEditor(s.options)).toEqual(unavailable);
				expect(s.resolve.mock.calls.at(-1)?.[0].toString()).toBe(path);
				expect(s.open).not.toHaveBeenCalled();
			}
		}
	},
);

it.each(["resolve", "open"] as const)(
	"returns only a safe error when %s throws",
	async (operation) => {
		const s = setup();
		s[operation].mockRejectedValue(new Error("/private/root secret"));
		expect(await openSkillEditor(s.options)).toEqual(unavailable);
		if (operation === "resolve") expect(s.open).not.toHaveBeenCalled();
	},
);

it("refuses an already stale operation without resolving", async () => {
	const s = setup();
	s.retire();
	expect(await openSkillEditor(s.options)).toEqual(err({ code: "stale" }));
	expect(s.resolve).not.toHaveBeenCalled();
	expect(s.open).not.toHaveBeenCalled();
});

it("refuses staleness during every resolve, including the final file", async () => {
	for (const scope of ["workspace", "global"] as const) {
		for (const path of setup(scope).paths) {
			const s = setup(scope);
			s.resolve.mockImplementation(async (uri) => {
				if (uri.toString() === path) s.retire();
				return s.metadata.get(uri.toString());
			});
			expect(await openSkillEditor(s.options)).toEqual(err({ code: "stale" }));
			expect(s.resolve.mock.calls.at(-1)?.[0].toString()).toBe(path);
			expect(s.open).not.toHaveBeenCalled();
		}
	}
});

it("reports stale after an open settles in a retired context", async () => {
	const s = setup();
	s.open.mockImplementation(async () => {
		s.retire();
		return null;
	});
	expect(await openSkillEditor(s.options)).toEqual(err({ code: "stale" }));
});
