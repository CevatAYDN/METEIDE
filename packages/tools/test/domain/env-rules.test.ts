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

	it("refuses shell tracing, exported bash functions, .NET hooks and names a shell cannot set", () => {
		expect(
			blockedEnvKeys({
				SHELLOPTS: "xtrace",
				BASHOPTS: "x",
				PS4: "$(x)",
				"BASH_FUNC_git%%": "() { x; }",
				COR_ENABLE_PROFILING: "1",
				CORECLR_PROFILER: "x",
				COMPlus_x: "1",
				DOTNET_STARTUP_HOOKS: "x",
				"A=B": "x",
				"1X": "x",
				MY_FLAG_2: "ok",
			}),
		).toEqual([
			"SHELLOPTS",
			"BASHOPTS",
			"PS4",
			"BASH_FUNC_git%%",
			"COR_ENABLE_PROFILING",
			"CORECLR_PROFILER",
			"COMPlus_x",
			"DOTNET_STARTUP_HOOKS",
			"A=B",
			"1X",
		]);
	});
});
