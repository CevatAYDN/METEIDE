import { err, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { descriptor, hash, setup, snapshot } from "./helpers/skill-catalog.js";

const signal = new AbortController().signal;
describe("native skill catalog", () => {
	it("constructs without startup I/O", () => {
		const { source } = setup();
		expect(source.list).not.toHaveBeenCalled();
		expect(source.read).not.toHaveBeenCalled();
	});
	it("keeps equal names source-qualified, orders entries and freshly inspects", async () => {
		const sources = [descriptor("workspace"), descriptor("global")];
		const { catalog, source } = setup(sources);
		const listed = await catalog.list(signal);
		expect(listed).toMatchObject({
			ok: true,
			value: {
				complete: true,
				diagnostics: [],
				entries: [
					{ source: descriptor("global") },
					{ source: descriptor("workspace") },
				],
			},
		});
		const inspected = await catalog.inspect(
			{ sourceId: hash("workspace") },
			signal,
		);
		expect(inspected).toEqual(
			ok({
				...snapshot(descriptor("workspace")),
				metadata: { name: "example", description: "Local review" },
			}),
		);
		expect(source.read).toHaveBeenCalledTimes(3);
		expect(source.list).toHaveBeenCalledOnce();
	});
	it("refuses core-labelled sources that composition did not attest", async () => {
		const { catalog, source } = setup(undefined, false);
		expect(await catalog.list(signal)).toMatchObject({
			ok: false,
			error: { code: "unavailable" },
		});
		expect(source.list).not.toHaveBeenCalled();
	});
	it.each(["list", "read"] as const)(
		"refuses disposal during %s",
		async (method) => {
			const { catalog, source, registration } = setup();
			if (method === "list") {
				vi.spyOn(source, "list").mockImplementation(async () => {
					registration.dispose();
					return ok({ sources: [], complete: true, diagnostics: [] });
				});
			} else {
				vi.spyOn(source, "read").mockImplementation(async () => {
					registration.dispose();
					return ok(snapshot(descriptor("workspace")));
				});
			}
			expect(await catalog.list(signal)).toMatchObject({
				ok: false,
				error: { code: "unavailable" },
			});
		},
	);
	it("preserves partial discovery and native source read refusals", async () => {
		const { catalog, source } = setup([]);
		vi.spyOn(source, "list").mockResolvedValue(
			ok({
				sources: [],
				complete: false,
				diagnostics: [{ code: "limit_exceeded", location: "root" }],
			}),
		);
		expect(await catalog.list(signal)).toEqual(
			ok({
				entries: [],
				complete: false,
				diagnostics: [{ code: "limit_exceeded", location: "root" }],
			}),
		);
		vi.spyOn(source, "read").mockResolvedValue(
			err({ code: "limit_exceeded", location: "root" }),
		);
		expect(
			await catalog.inspect({ sourceId: hash("workspace") }, signal),
		).toMatchObject({ ok: false, error: { code: "limit_exceeded" } });
	});
});
