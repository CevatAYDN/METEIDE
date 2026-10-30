import { err, ok } from "@mete/contracts";
import type { MessageService } from "@theia/core";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { describe, expect, it } from "vitest";
import { draftOf, teamOf } from "../src/application/team-draft.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";
import { TeamPins } from "../src/infrastructure/team-pins.js";

// The team editor's pins (ADR-077) over a fake file service and a fake daemon: a pin is written at
// once, a file left with no pin is deleted, an unreadable file is never written over, and a tier's
// models are asked once.

const ROOT = URI.fromFilePath("/w");
const PINS = ROOT.resolve(".mete/pins.yaml").path.fsPath();

const fake = (
	initial: Record<string, string> = {},
	chain: unknown = ok({ models: [] }),
) => {
	const disk = new Map(Object.entries(initial));
	const said: string[] = [];
	const asked: string[] = [];
	const files = {
		exists: async (u: URI) => disk.has(u.path.fsPath()),
		read: async (u: URI) => ({ value: disk.get(u.path.fsPath()) ?? "" }),
		write: async (u: URI, text: string) => void disk.set(u.path.fsPath(), text),
		delete: async (u: URI) => void disk.delete(u.path.fsPath()),
	} as unknown as FileService;
	const note = async (text: string) => void said.push(text);
	const messages = { warn: note, error: note } as unknown as MessageService;
	const daemon = {
		chain: async (_dir: string, tier: string, needs: readonly string[]) => {
			asked.push([tier, ...needs].join("|"));
			return chain;
		},
		models: async (_dir: string, refs: readonly unknown[]) => {
			asked.push(`models:${refs.length}`);
			return ok({ models: [] });
		},
		quota: async () => ok({ providers: [{ id: "groq", state: "ready" }] }),
	} as unknown as MeteDaemonService;
	return { pins: new TeamPins({ files, messages, daemon }), disk, said, asked };
};

describe("TeamPins", () => {
	it("writes a pin at once, offers it back, and deletes the file when the last pin goes", async () => {
		const { pins, disk } = fake();
		await pins.read(ROOT);
		expect(pins.of("web-dev")).toEqual({});
		const set = await pins.set(ROOT, "web-dev", "qa", "groq/fast-one");
		expect(set).toEqual({ qa: "groq/fast-one" });
		expect(disk.get(PINS)).toContain("groq/fast-one");
		expect(pins.of("web-dev")).toEqual({ qa: "groq/fast-one" });
		expect(await pins.set(ROOT, "web-dev", "qa", undefined)).toEqual({});
		expect(disk.has(PINS)).toBe(false);
	});

	it("says so and writes nothing while the pins file does not parse", async () => {
		const { pins, disk, said } = fake({ [PINS]: "a: [unclosed" });
		await pins.read(ROOT);
		expect(await pins.set(ROOT, "web-dev", "qa", "groq/x")).toBeUndefined();
		expect(said.join()).toContain("METE cannot read .mete/pins.yaml");
		expect(disk.get(PINS)).toBe("a: [unclosed");
	});

	it("refuses a pin the schema refuses, and keeps the file as it was", async () => {
		const { pins, disk, said } = fake({ [PINS]: "web-dev:\n  qa: groq/old\n" });
		await pins.read(ROOT);
		expect(await pins.set(ROOT, "web-dev", "qa", "not-a-pin")).toBeUndefined();
		expect(said.join()).toContain("This pin is not saved");
		expect(disk.get(PINS)).toBe("web-dev:\n  qa: groq/old\n");
		expect(pins.of("web-dev")).toEqual({ qa: "groq/old" });
	});

	it("asks for a tier's models once per tier and needs, and says whether a list came", async () => {
		const { pins, asked } = fake(
			{},
			ok({ models: [{ providerId: "groq", modelId: "m" }] }),
		);
		const doc = draftOf(
			"roles: [{ id: a, tier: coder, needs: [tool_calling] }, { id: b, tier: coder, needs: [tool_calling] }, { id: c, tier: nope }]",
		);
		if (!doc.ok) throw new Error(doc.error);
		const team = teamOf(doc.value);
		expect(await pins.fetchChains(ROOT, team)).toBe(true);
		// The picker's facts and states follow the chains, once (ADR-161).
		expect(asked).toEqual(["coder|tool_calling", "models:1"]);
		expect([...pins.chains]).toEqual([["coder|tool_calling", ["groq/m"]]]);
		expect(pins.picker?.states).toEqual([{ id: "groq", state: "ready" }]);
		expect(await pins.fetchChains(ROOT, team)).toBe(false);
		expect(asked).toHaveLength(2);
	});

	it("offers no models for a tier whose ask failed, and does not ask again", async () => {
		const failed = err({ code: "unavailable" as const, message: "no" });
		const { pins, asked } = fake({}, failed);
		const doc = draftOf("roles: [{ id: a, tier: fast }]");
		if (!doc.ok) throw new Error(doc.error);
		const team = teamOf(doc.value);
		expect(await pins.fetchChains(ROOT, team)).toBe(false);
		expect(await pins.fetchChains(ROOT, team)).toBe(false);
		expect(asked).toEqual(["fast"]);
		expect([...pins.chains]).toEqual([["fast", []]]);
	});
});
