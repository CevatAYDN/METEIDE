import { describe, expect, it } from "vitest";
import { capPayload, isCutPayload } from "../../src/domain/payload-cap.js";

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

describe("capPayload", () => {
	it("keeps a payload under the limit as its JSON", () => {
		const r = capPayload({ reason: "lost" }, 64);
		expect(r).toEqual({ json: '{"reason":"lost"}', cut: false });
	});

	it("keeps a payload exactly at the limit", () => {
		const json = JSON.stringify({ a: "x".repeat(10) });
		const r = capPayload({ a: "x".repeat(10) }, bytes(json));
		expect(r).toEqual({ json, cut: false });
	});

	it("cuts a payload one byte over the limit to a marker that fits", () => {
		const payload = { a: "x".repeat(200) };
		const json = JSON.stringify(payload);
		const limit = bytes(json) - 1;
		const r = capPayload(payload, limit);
		expect(r.cut).toBe(true);
		expect(bytes(r.json)).toBeLessThanOrEqual(limit);
		expect(bytes(r.json)).toBeGreaterThan(limit - 4);
		const marker: unknown = JSON.parse(r.json);
		expect(marker).toMatchObject({ cut: true, bytes: bytes(json) });
		expect(isCutPayload(marker)).toBe(true);
	});

	it("keeps the head of the original JSON so a reader sees what it was", () => {
		const payload = { text: "hello ".repeat(1000) };
		const r = capPayload(payload, 200);
		const marker = JSON.parse(r.json) as { head: string; bytes: number };
		expect(bytes(r.json)).toBeLessThanOrEqual(200);
		expect(marker.head.startsWith('{"text":"hello hello')).toBe(true);
		expect(marker.bytes).toBe(bytes(JSON.stringify(payload)));
	});

	it("counts bytes, not characters, and still fits with multibyte text", () => {
		const payload = { text: "é€😀".repeat(500) };
		const r = capPayload(payload, 300);
		expect(r.cut).toBe(true);
		expect(bytes(r.json)).toBeLessThanOrEqual(300);
		expect(() => JSON.parse(r.json)).not.toThrow();
	});

	it("does not take a plain payload for a cut marker", () => {
		expect(isCutPayload({ cut: true })).toBe(false);
		expect(isCutPayload({ reason: "lost" })).toBe(false);
		expect(isCutPayload("cut")).toBe(false);
	});
});
