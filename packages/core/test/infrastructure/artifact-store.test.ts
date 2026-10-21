import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createArtifactStore } from "../../src/infrastructure/artifact-store.js";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-artifacts-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("artifact store", () => {
	it("writes a report under .mete/artifacts/<run id>/ and returns its path and hash", async () => {
		const store = createArtifactStore(root);
		const r = await store.write({
			runId: "r1",
			name: "report.json",
			content: "{}",
		});
		expect(r).toEqual({
			ok: true,
			value: {
				path: ".mete/artifacts/r1/report.json",
				sha256: createHash("sha256").update("{}").digest("hex"),
			},
		});
		const text = await readFile(
			join(root, ".mete", "artifacts", "r1", "report.json"),
			"utf8",
		);
		expect(text).toBe("{}");
	});

	it("replaces the file of a later submission", async () => {
		const store = createArtifactStore(root);
		await store.write({ runId: "r1", name: "a.md", content: "one" });
		await store.write({ runId: "r1", name: "a.md", content: "two" });
		expect(
			await readFile(join(root, ".mete", "artifacts", "r1", "a.md"), "utf8"),
		).toBe("two");
	});

	it("answers io instead of throwing when the folder cannot be made", async () => {
		const store = createArtifactStore(join(root, "missing\u0000"));
		const r = await store.write({ runId: "r1", name: "a.md", content: "x" });
		expect(r.ok ? "ok" : r.error.code).toBe("io");
	});
});
