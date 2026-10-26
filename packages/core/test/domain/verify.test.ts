import { describe, expect, it } from "vitest";
import {
	gateError,
	gateFailure,
	gateName,
	gateRefused,
} from "../../src/domain/verify.js";

// The messages a failed verify gate sends back to the agent (docs/08, Task execution sequence, step 3).
// Written by a free model in the METE-on-METE dogfood run of 2026-10-26.

const run = (
	exitCode: number | null,
	stdout = "",
	stderr = "",
	timedOut = false,
) => ({
	exitCode,
	stdout,
	stderr,
	timedOut,
});

describe("gateName", () => {
	it("names a command gate by its run command", () => {
		expect(gateName({ run: "npm test" })).toBe("npm test");
	});

	it("names a capability gate by its capability id", () => {
		expect(gateName({ capability: "research-report@1" })).toBe(
			"research-report@1",
		);
	});
});

describe("gateFailure", () => {
	it("is undefined when the command exited 0 and did not time out", () => {
		expect(gateFailure("npm test", run(0))).toBeUndefined();
	});

	it("reports a timed out command", () => {
		expect(
			gateFailure("npm test", run(null, "stdout here", "stderr here", true)),
		).toBe(
			`The verify gate \`npm test\` timed out.\n\nstdout:\nstdout here\n\nstderr:\nstderr here\n\nFix what it reports, then give your report again.`,
		);
	});

	it("reports a killed process (exitCode null)", () => {
		expect(gateFailure("npm test", run(null))).toBe(
			`The verify gate \`npm test\` was killed.\n\nFix what it reports, then give your report again.`,
		);
	});

	it("reports a non-zero exit code", () => {
		expect(gateFailure("npm test", run(1))).toBe(
			`The verify gate \`npm test\` exited with code 1.\n\nFix what it reports, then give your report again.`,
		);
	});

	it("omits a stream that holds only whitespace", () => {
		expect(gateFailure("npm test", run(2, "  \n", "\r\n"))).toBe(
			`The verify gate \`npm test\` exited with code 2.\n\nFix what it reports, then give your report again.`,
		);
	});
});

describe("gateError", () => {
	it("names the capability and the reason", () => {
		expect(gateError("research-report@1", "no sources found")).toBe(
			`The verify gate \`research-report@1\` failed: no sources found\n\nFix what it reports, then give your report again.`,
		);
	});
});

describe("gateRefused", () => {
	it("names the command and the reason it could not run", () => {
		expect(gateRefused("npm test", "command not found")).toBe(
			`The verify gate \`npm test\` could not run: command not found\n\nChange what stops it, then give your report again.`,
		);
	});
});
