import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// ADR-185: the approved experimental Windows update must not ship the 0.0.0 baseline again.
it("identifies the experimental desktop release without enabling npm publication", () => {
	const manifest: unknown = JSON.parse(
		readFileSync(join(process.cwd(), "package.json"), "utf8"),
	);
	expect(manifest).toMatchObject({
		name: "@mete/desktop",
		version: "0.0.1",
		private: true,
	});
});
