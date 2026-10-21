import { describe, expect, it } from "vitest";
import {
	CapabilityRefSchema,
	EventTypeSchema,
	IdSchema,
	ModuleIdSchema,
	TimestampSchema,
} from "../../src/domain/ids.js";

const valid = (
	schema: { safeParse(v: unknown): { success: boolean } },
	v: unknown,
) => schema.safeParse(v).success;

describe("CapabilityRefSchema", () => {
	it.each([
		"knowledge.search@1",
		"3d.cleanup@1",
		"media.image.generate@1",
		"media.3d.fromText@1",
		"gameengine.importAsset@12",
	])("accepts %s", (v) => expect(valid(CapabilityRefSchema, v)).toBe(true));

	it.each([
		"knowledge@1",
		"knowledge.search",
		"knowledge.search@0",
		"Knowledge.search@1",
		"knowledge..search@1",
		"knowledge.search@1.2",
		"fs.*@1",
		42,
	])("rejects %s", (v) => expect(valid(CapabilityRefSchema, v)).toBe(false));
});

describe("EventTypeSchema", () => {
	it.each([
		"run.started",
		"task.status.changed",
		"agent.thinking.ended",
		"network.lost",
	])("accepts %s", (v) => expect(valid(EventTypeSchema, v)).toBe(true));

	it.each([
		"run",
		"Run.started",
		"run.started.",
		"run_started",
		"run.started@1",
	])("rejects %s", (v) => expect(valid(EventTypeSchema, v)).toBe(false));
});

describe("ModuleIdSchema", () => {
	it.each(["storage", "provider-opencode-zen", "ui-studio"])(
		"accepts %s",
		(v) => expect(valid(ModuleIdSchema, v)).toBe(true),
	);

	it.each(["Storage", "provider_nvidia", "-tools", "tools-", "tools--fs", ""])(
		"rejects %s",
		(v) => expect(valid(ModuleIdSchema, v)).toBe(false),
	);
});

describe("IdSchema and TimestampSchema", () => {
	it("accepts crypto.randomUUID()", () => {
		expect(valid(IdSchema, crypto.randomUUID())).toBe(true);
		expect(valid(IdSchema, "not-a-uuid")).toBe(false);
	});

	it("accepts only ISO 8601 in UTC", () => {
		expect(valid(TimestampSchema, new Date().toISOString())).toBe(true);
		expect(valid(TimestampSchema, "2026-10-21T10:00:00+03:00")).toBe(false);
		expect(valid(TimestampSchema, "2026-10-21")).toBe(false);
	});
});
