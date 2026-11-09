import type {
	SkillRuntimeAdapter,
	SkillSelectionAdapter,
	SkillTrustAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { App } from "../src/infrastructure/app.js";
import { skillAppFixture, skillText } from "./skill-app-fixture.js";

let fixture: Awaited<ReturnType<typeof skillAppFixture>> | undefined;
afterEach(async () => {
	await fixture?.close();
});
const signal = () => new AbortController().signal;
const resolve = <C>(app: App, ref: "skill.runtime@1" | "skill.selection@1") => {
	const found = app.registry.resolve<C>(ref);
	if (!found.ok) throw new Error(`${ref} missing`);
	return found.value[0].impl;
};

/** Approves one workspace skill through the real native trust module. */
const approved = async (trust: SkillTrustAdapter) => {
	const listed = await trust.status(signal());
	if (!listed.ok) throw new Error("status failed");
	const sourceId = listed.value.entries[0]?.source.sourceId ?? "";
	const preview = await trust.prepare({ sourceId }, signal());
	if (!preview.ok) throw new Error("preview failed");
	const done = await trust.approve(
		{ previewId: preview.value.previewId },
		signal(),
	);
	if (!done.result.ok) throw new Error("approve failed");
	return {
		sourceId,
		sha256: preview.value.inspection.sha256,
		revision: done.result.value.revision,
	};
};

describe("native S2 composition (T1)", () => {
	it("hands security the native attestations so preflight and catalog work end to end", async () => {
		fixture = await skillAppFixture();
		await fixture.write("workspace", "review", skillText("review"));
		const app = await fixture.start();
		const release = await fixture.lock();
		const version = await approved(fixture.trust(app));
		await release();
		const selection = resolve<SkillSelectionAdapter>(app, "skill.selection@1");
		expect(await selection.check({ selected: [version] }, signal())).toEqual({
			ok: true,
			value: null,
		});
		const runtime = resolve<SkillRuntimeAdapter>(app, "skill.runtime@1");
		const catalog = await runtime.catalog(signal());
		expect(catalog).toMatchObject({
			ok: true,
			value: { status: "ready", entries: [{ version, name: "review" }] },
		});
	});

	it("refuses a load that core did not admit, even with a valid version", async () => {
		fixture = await skillAppFixture();
		await fixture.write("workspace", "review", skillText("review"));
		const app = await fixture.start();
		const release = await fixture.lock();
		const version = await approved(fixture.trust(app));
		await release();
		const runtime = resolve<SkillRuntimeAdapter>(app, "skill.runtime@1");
		const forged = await runtime.load(
			{
				owner: {
					runId: "00000000-0000-4000-8000-000000000001",
					contextId: "00000000-0000-4000-8000-000000000002",
				},
				operationId: "00000000-0000-4000-8000-000000000003",
				version,
				origin: "model",
			},
			signal(),
		);
		expect(forged).toEqual({ ok: false, error: { code: "stale" } });
	});
});
