import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillTrustAdapter } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { skillAppFixture, skillText } from "./skill-app-fixture.js";

let fixture: Awaited<ReturnType<typeof skillAppFixture>> | undefined;
afterEach(async () => {
	await fixture?.close();
});
const setup = async () => {
	fixture = await skillAppFixture();
	return fixture;
};
const signal = () => new AbortController().signal;
const inventory = async (trust: SkillTrustAdapter) => {
	const listed = await trust.status(signal());
	if (!listed.ok) throw new Error("inventory failed");
	return listed.value.entries;
};
const review = async (trust: SkillTrustAdapter, sourceId: string) => {
	const prepared = await trust.prepare({ sourceId }, signal());
	if (!prepared.ok) throw new Error("preview failed");
	return prepared.value;
};

describe("native version approval and persistence", () => {
	it("prepares, approves, marks changed bytes, disables and reopens without rewriting skills", async () => {
		const t = await setup();
		const text = skillText("public");
		const path = await t.write("workspace", "public", text);
		const app = await t.start();
		const release = await t.lock();
		const trust = t.trust(app);
		const sourceId = (await inventory(trust))[0]?.source.sourceId ?? "";
		const preview = await review(trust, sourceId);
		expect(preview.inspection.text).toBe(text);
		expect((await inventory(trust))[0]?.status).toBe("unapproved");
		expect(
			await trust.approve({ previewId: preview.previewId }, signal()),
		).toMatchObject({
			admitted: true,
			result: { ok: true, value: { status: "approved", revision: 1 } },
		});
		await writeFile(path, skillText("public", "Changed instructions."));
		expect((await inventory(trust))[0]?.status).toBe("changed");
		await writeFile(path, text);
		expect((await inventory(trust))[0]?.status).toBe("approved");
		await t.stop(app);
		await release();
		const reopened = await t.start();
		const releaseAgain = await t.lock();
		const persisted = t.trust(reopened);
		expect((await inventory(persisted))[0]).toMatchObject({
			status: "approved",
			revision: 1,
		});
		expect(
			await persisted.disable({ sourceId, expectedRevision: 1 }, signal()),
		).toMatchObject({
			admitted: true,
			result: { ok: true, value: { status: "disabled", revision: 2 } },
		});
		await t.stop(reopened);
		await releaseAgain();
		const disabled = await t.start();
		expect((await inventory(t.trust(disabled)))[0]).toMatchObject({
			status: "disabled",
			revision: 2,
		});
		expect(await readFile(path, "utf8")).toBe(text);
		expect(t.fetch).not.toHaveBeenCalled();
	});

	it.each(["bytes", "ignore", "root"] as const)(
		"refuses a preview after %s changes without creating a grant",
		async (change) => {
			const t = await setup();
			const path = await t.write("workspace", "public", skillText("public"));
			const app = await t.start();
			await t.lock();
			const trust = t.trust(app);
			const sourceId = (await inventory(trust))[0]?.source.sourceId ?? "";
			const preview = await review(trust, sourceId);
			if (change === "bytes")
				await writeFile(path, skillText("public", "Changed."));
			if (change === "ignore")
				await writeFile(
					join(t.repo.workspaceDir, ".meteignore"),
					".mete/skills/\n",
				);
			if (change === "root") {
				const root = join(t.repo.workspaceDir, ".mete", "skills");
				await rename(root, join(t.repo.workspaceDir, ".mete", "old-skills"));
				await t.write("workspace", "public", skillText("public"));
			}
			expect(
				await trust.approve({ previewId: preview.previewId }, signal()),
			).toMatchObject({ admitted: true, result: { ok: false } });
			if (change === "ignore") {
				expect(await trust.status(signal())).toMatchObject({
					ok: true,
					value: {
						entries: [],
						diagnostics: expect.arrayContaining([
							expect.objectContaining({ code: "ignored", sourceId }),
						]),
					},
				});
				await writeFile(join(t.repo.workspaceDir, ".meteignore"), "");
			}
			await t.write("workspace", "public", skillText("public"));
			expect(await inventory(trust)).toEqual([
				expect.objectContaining({ status: "unapproved", revision: 0 }),
			]);
			expect(t.fetch).not.toHaveBeenCalled();
		},
	);

	it("keeps global grants workspace-bound even with copied workspace UUID and SQLite", async () => {
		const t = await setup();
		await t.write("global", "public", skillText("public"));
		const app = await t.start();
		const release = await t.lock();
		const trust = t.trust(app);
		const sourceId = (await inventory(trust))[0]?.source.sourceId ?? "";
		const preview = await review(trust, sourceId);
		expect(
			await trust.approve({ previewId: preview.previewId }, signal()),
		).toMatchObject({ admitted: true, result: { ok: true } });
		await t.stop(app);
		await release();
		const workspaceDir = join(t.repo.globalDir, "other-workspace");
		await mkdir(join(workspaceDir, ".mete"), { recursive: true });
		for (const name of ["workspace.yaml", "mete.db"])
			await copyFile(
				join(t.repo.workspaceDir, ".mete", name),
				join(workspaceDir, ".mete", name),
			);
		const other = await t.start({ workspaceDir });
		expect((await inventory(t.trust(other)))[0]).toMatchObject({
			source: { sourceId, scope: "global" },
			status: "unapproved",
			revision: 0,
		});
		await t.stop(other);
		const original = await t.start();
		expect((await inventory(t.trust(original)))[0]).toMatchObject({
			source: { sourceId },
			status: "approved",
			revision: 1,
		});
	});
});
