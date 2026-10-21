import { describe, expect, it } from "vitest";
import { blockedEnvKeys } from "../../src/domain/env-rules.js";

describe("blockedEnvKeys", () => {
	it("refuses keys that change what runs, in any case, and passes the rest", () => {
		expect(
			blockedEnvKeys({
				Path: "x",
				NODE_OPTIONS: "--require x",
				dyld_insert_libraries: "x",
				GIT_DIR: "x",
				Env: "x",
				CI: "1",
				NODE_ENV: "test",
				PYTHONUNBUFFERED: "1",
			}),
		).toEqual([
			"Path",
			"NODE_OPTIONS",
			"dyld_insert_libraries",
			"GIT_DIR",
			"Env",
		]);
	});
});
