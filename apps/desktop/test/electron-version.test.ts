import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The installer names its Electron in electron-builder.yml because the staged package.json carries
// production dependencies only; the app the repository runs takes package.json's. A security
// release moved in one and not the other ships the old Electron (docs/15, builds; ADR-115).
// The package is CommonJS (ADR-002), so no import.meta: vitest runs from this package's root.

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("the installer's Electron", () => {
	it("is the Electron the repository runs", () => {
		const pkg = JSON.parse(read("package.json")) as {
			devDependencies: Record<string, string>;
		};
		const builder = /^electronVersion:\s*(\S+)\s*$/m.exec(
			read("electron-builder.yml"),
		)?.[1];
		expect(builder).toBe(pkg.devDependencies.electron);
	});
});
