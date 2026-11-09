import { generateKeyPairSync } from "node:crypto";
import { link, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	SkillSourceAdapter,
	SkillTrustAdapter,
	StorageSqlAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { App } from "../src/infrastructure/app.js";
import { skillAppFixture, skillText } from "./skill-app-fixture.js";

let fixture: Awaited<ReturnType<typeof skillAppFixture>> | undefined;
afterEach(async () => {
	vi.restoreAllMocks();
	await fixture?.close();
	fixture = undefined;
});
const signal = () => new AbortController().signal;
const counts = (app: App) => {
	const storage = app.registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!storage.ok) throw new Error("Fixture storage missing");
	const db = storage.value[0].impl.scopeFor("skills-trust").global;
	const count = z.number().int().nonnegative();
	return {
		grants: count.parse(
			db.prepare("SELECT COUNT(*) FROM skill_trust_grants").pluck().get(),
		),
		decisions: count.parse(
			db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get(),
		),
	};
};
const populated = async (count: number) => {
	fixture = await skillAppFixture();
	for (let i = 0; i < count; i++) {
		const name = `skill-${i}`;
		await fixture.write("workspace", name, skillText(name));
	}
	const app = await fixture.start();
	await fixture.lock();
	return { fixture, app, trust: fixture.trust(app) };
};
const sourceIdOf = async (trust: SkillTrustAdapter) => {
	const listed = await trust.status(signal());
	if (!listed.ok) throw new Error("Fixture inventory failed");
	const entry = listed.value.entries[0];
	if (!entry) throw new Error("Fixture skill missing");
	return entry.source.sourceId;
};

describe("native skill review boundaries", { timeout: 60_000 }, () => {
	it("keeps decoded metadata secrets out of the complete preview text too", async () => {
		fixture = await skillAppFixture();
		const pem = generateKeyPairSync("rsa", { modulusLength: 1024 })
			.privateKey.export({ type: "pkcs8", format: "pem" })
			.toString()
			.trim()
			.replaceAll("\n", "\r\n");
		const keyBody = pem.split("\r\n")[1] ?? "";
		expect(keyBody.length).toBeGreaterThan(40);
		await fixture.write(
			"workspace",
			"quoted-key",
			`---\nname: quoted-key\ndescription: ${JSON.stringify(pem)}\n---\nReview fixture.\n`,
		);
		const app = await fixture.start();
		const trust = fixture.trust(app);
		const sourceId = await sourceIdOf(trust);
		const preview = await trust.prepare({ sourceId }, signal());
		if (!preview.ok) throw new Error("Expected a safely masked preview");
		expect(preview.value.inspection.metadata.description).toMatch(
			/^\[SECRET:[a-f0-9]{8}\]$/,
		);
		expect(JSON.stringify(preview.value)).not.toContain(keyBody);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it.each([
		{ change: "ignore", code: "ignored" },
		{ change: "hardlink", code: "bad_input" },
	] as const)(
		"keeps an approved source revocable after $change",
		async ({ change, code }) => {
			const t = await populated(1);
			const sourceId = await sourceIdOf(t.trust);
			const preview = await t.trust.prepare({ sourceId }, signal());
			if (!preview.ok) throw new Error("Fixture preview failed");
			expect(
				await t.trust.approve({ previewId: preview.value.previewId }, signal()),
			).toMatchObject({
				admitted: true,
				result: { ok: true, value: { revision: 1 } },
			});
			if (change === "ignore")
				await writeFile(
					join(t.fixture.repo.workspaceDir, ".meteignore"),
					".mete/skills/\n",
				);
			else
				await link(
					join(
						t.fixture.repo.workspaceDir,
						".mete",
						"skills",
						"skill-0",
						"SKILL.md",
					),
					join(t.fixture.repo.globalDir, "skill-copy.md"),
				);
			const listed = await t.trust.status(signal());
			if (!listed.ok) throw new Error("Rejected grant must remain visible");
			expect(listed.value.complete).toBe(true);
			expect(listed.value.entries).toHaveLength(1);
			expect(listed.value.entries[0]).toMatchObject({
				source: { sourceId },
				status: "invalid",
				revision: 1,
				approvedSha256: preview.value.inspection.sha256,
				diagnostics: expect.arrayContaining([
					expect.objectContaining({ code, sourceId }),
				]),
			});
			expect(await t.trust.prepare({ sourceId }, signal())).toMatchObject({
				ok: false,
			});
			const disabled = await t.trust.disable(
				{ sourceId, expectedRevision: 1 },
				signal(),
			);
			expect(disabled).toMatchObject({
				admitted: true,
				result: { ok: true, value: { revision: 2 } },
			});
			if (!disabled.result.ok) throw new Error("Disable failed");
			expect(disabled.result.value.approvedSha256).toBeUndefined();
			expect(counts(t.app)).toEqual({ grants: 1, decisions: 2 });
			expect(t.fixture.fetch).not.toHaveBeenCalled();
		},
	);

	it.each(["before-review", "after-review"] as const)(
		"refuses oversized inventory %s without writing a grant or audit decision",
		async (when) => {
			const t = await populated(128);
			const sourceId = await sourceIdOf(t.trust);
			const preview =
				when === "after-review"
					? await t.trust.prepare({ sourceId }, signal())
					: undefined;
			if (preview && !preview.ok) throw new Error("Fixture preview failed");
			await t.fixture.write("workspace", "overflow", skillText("overflow"));
			if (preview?.ok) {
				expect(
					await t.trust.approve(
						{ previewId: preview.value.previewId },
						signal(),
					),
				).toMatchObject({
					admitted: true,
					result: { ok: false, error: { code: "limit_exceeded" } },
				});
			} else {
				expect(await t.trust.prepare({ sourceId }, signal())).toMatchObject({
					ok: false,
					error: { code: "limit_exceeded" },
				});
			}
			expect(counts(t.app)).toEqual({ grants: 0, decisions: 0 });
			expect(t.fixture.fetch).not.toHaveBeenCalled();
		},
	);

	it("keeps historical grants revocable during a real 129-source overflow", async () => {
		const t = await populated(1);
		const sourceId = await sourceIdOf(t.trust);
		const first = await t.trust.prepare({ sourceId }, signal());
		if (!first.ok) throw new Error("Fixture preview failed");
		expect(
			await t.trust.approve({ previewId: first.value.previewId }, signal()),
		).toMatchObject({
			admitted: true,
			result: { ok: true, value: { revision: 1 } },
		});
		const pending = await t.trust.prepare({ sourceId }, signal());
		if (!pending.ok) throw new Error("Fixture second preview failed");
		for (let i = 1; i < 129; i++) {
			const name = `skill-${i}`;
			await t.fixture.write("workspace", name, skillText(name));
		}
		const listed = await t.trust.status(signal());
		if (!listed.ok) throw new Error("Historical grant must survive overflow");
		expect(listed.value).toMatchObject({
			complete: false,
			entries: [
				{
					source: { sourceId },
					status: "unavailable",
					revision: 1,
					approvedSha256: first.value.inspection.sha256,
				},
			],
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ code: "limit_exceeded" }),
			]),
		});
		expect(listed.value.entries[0]?.metadata).toBeUndefined();
		expect(listed.value.entries[0]?.currentSha256).toBeUndefined();
		expect(await t.trust.prepare({ sourceId }, signal())).toMatchObject({
			ok: false,
			error: { code: "limit_exceeded" },
		});
		expect(
			await t.trust.approve({ previewId: pending.value.previewId }, signal()),
		).toMatchObject({
			admitted: true,
			result: { ok: false, error: { code: "limit_exceeded" } },
		});
		expect(counts(t.app)).toEqual({ grants: 1, decisions: 1 });
		expect(
			await t.trust.disable({ sourceId, expectedRevision: 1 }, signal()),
		).toMatchObject({
			admitted: true,
			result: { ok: true, value: { status: "disabled", revision: 2 } },
		});
		const after = await t.trust.status(signal());
		if (!after.ok) throw new Error("Disabled receipt must remain readable");
		expect(after.value).toMatchObject({
			complete: false,
			entries: [{ source: { sourceId }, status: "unavailable", revision: 2 }],
		});
		expect(after.value.entries[0]?.approvedSha256).toBeUndefined();
		expect(
			await t.trust.disable({ sourceId, expectedRevision: 1 }, signal()),
		).toMatchObject({
			admitted: true,
			result: { ok: false, error: { code: "stale" } },
		});
		expect(counts(t.app)).toEqual({ grants: 1, decisions: 2 });
		expect(t.fixture.fetch).not.toHaveBeenCalled();
	});

	it("reads bytes linearly for a complete 128-source status operation", async () => {
		const t = await populated(128);
		const source = t.app.registry.resolve<SkillSourceAdapter>("skill.source@1");
		if (!source.ok) throw new Error("Fixture native source missing");
		const reads = vi.spyOn(source.value[0].impl, "read");
		const lists = vi.spyOn(source.value[0].impl, "list");
		const listed = await t.trust.status(signal());
		if (!listed.ok) throw new Error("Fixture inventory failed");
		expect(listed.value.complete).toBe(true);
		expect(listed.value.entries).toHaveLength(128);
		expect(
			listed.value.entries.every((entry) => entry.status === "unapproved"),
		).toBe(true);
		expect(reads.mock.calls.length).toBeGreaterThanOrEqual(128);
		expect(reads.mock.calls.length).toBeLessThanOrEqual(3 * 128);
		expect(lists.mock.calls.length).toBeLessThanOrEqual(2);
		expect(counts(t.app)).toEqual({ grants: 0, decisions: 0 });
		expect(t.fixture.fetch).not.toHaveBeenCalled();
	});
});
