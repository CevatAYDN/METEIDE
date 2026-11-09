import type { CapabilityRef } from "@mete/contracts";

type OutputFixture = {
	ref: CapabilityRef;
	args: Record<string, unknown>;
	value: unknown;
};

/** Valid catalog responses from the exported capability contracts, not validator-derived data. */
export const verificationOutputs: readonly OutputFixture[] = [
	{
		ref: "fs.read@1",
		args: { path: "a.txt" },
		value: { content: "", totalLines: 0, lineEnding: "none" },
	},
	{
		ref: "fs.write@1",
		args: { path: "a.txt", content: "" },
		value: { bytes: 0 },
	},
	{
		ref: "fs.edit@1",
		args: { path: "a.txt", oldStr: "old", newStr: "new" },
		value: { replacements: 1 },
	},
	{ ref: "fs.list@1", args: { path: "." }, value: { paths: [] } },
	{ ref: "fs.glob@1", args: { pattern: "*.ts" }, value: { paths: [] } },
	{
		ref: "fs.grep@1",
		args: { pattern: "text" },
		value: {
			matches: [{ path: "a.txt", line: 1, text: "text" }],
			truncated: false,
		},
	},
	{
		ref: "shell.exec@1",
		args: { command: "check" },
		value: {
			exitCode: 0,
			stdout: "",
			stderr: "",
			timedOut: false,
			os: "test",
			shell: "sh",
		},
	},
	{
		ref: "vcs.git@2",
		args: { op: "status" },
		value: {
			op: "status",
			branch: null,
			files: [{ path: "a.txt", index: "M", worktree: " " }],
		},
	},
	{ ref: "vcs.git@2", args: { op: "diff" }, value: { op: "diff", diff: "" } },
	{
		ref: "vcs.git@2",
		args: { op: "commit", message: "Change" },
		value: { op: "commit", sha: "a".repeat(40) },
	},
	{ ref: "web.search@1", args: { query: "query" }, value: { results: [] } },
	{
		ref: "web.fetch@1",
		args: { url: "https://example.test/" },
		value: { markdown: "", title: "", finalUrl: "https://example.test/" },
	},
	{
		ref: "vault.read@1",
		args: { path: "lesson.md" },
		value: { path: "lesson.md", content: "" },
	},
	{
		ref: "vault.write@1",
		args: { type: "lesson", title: "Lesson", body: "Body" },
		value: { path: "lesson.md", created: false },
	},
	{
		ref: "knowledge.search@1",
		args: { query: "query" },
		value: {
			results: [
				{
					path: "lesson.md",
					scope: "workspace",
					type: "lesson",
					title: "Lesson",
					snippet: "Body",
					sources: { keyword: 1 },
				},
			],
		},
	},
	{
		ref: "browser.screenshot@2",
		args: { url: "https://example.test/" },
		value: { path: "image.png", width: 800, height: 600 },
	},
	{
		ref: "seo.audit@2",
		args: { url: "https://example.test/" },
		value: {
			scores: { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 },
			audits: [{ id: "audit", title: "Audit", score: null }],
			reportPath: "audit.json",
		},
	},
	{
		ref: "media.image.generate@1",
		args: { prompt: "Image" },
		value: { file: "image.png" },
	},
	{
		ref: "media.image.edit@1",
		args: { file: "image.png", prompt: "Edit" },
		value: { file: "edited.png" },
	},
	{
		ref: "media.3d.fromText@1",
		args: { prompt: "Model" },
		value: { file: "model.glb" },
	},
	{
		ref: "media.3d.fromImage@1",
		args: { file: "image.png" },
		value: { file: "model.glb" },
	},
	{
		ref: "3d.cleanup@1",
		args: { file: "model.glb", ops: ["decimate"] },
		value: { file: "clean.glb", report: "" },
	},
	{
		ref: "3d.export@1",
		args: { file: "model.glb", format: "obj" },
		value: { file: "model.obj" },
	},
	{ ref: "gameengine.build@1", args: {}, value: { log: "" } },
	{ ref: "gameengine.test@1", args: {}, value: { log: "" } },
	{
		ref: "gameengine.importAsset@1",
		args: { file: "image.png" },
		value: { log: "" },
	},
];
