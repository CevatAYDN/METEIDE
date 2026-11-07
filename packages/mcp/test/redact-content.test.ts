import { describe, expect, it } from "vitest";
import { redactWireValue } from "../src/application/redact-content.js";
import { resultScope } from "../src/domain/render.js";
import { redactCredentials } from "../src/infrastructure/credential-fields.js";

describe("MCP exact-value redaction", () => {
	it("redacts secrets restored by JSON text decoding before a mapping reads them", () => {
		const secret = 'ab"cd';
		const parsed = resultScope(undefined, [JSON.stringify({ value: secret })]);
		expect(
			redactWireValue(parsed, (text) => redactCredentials(text, [secret]))
				.value,
		).toBe("[REDACTED]");
	});
	it("masks nested tool output and metadata before storage or mapping", () => {
		const secret = 'private-"sentinel';
		const result = redactWireValue(
			{
				text: `value ${secret}`,
				nested: [{ [secret]: secret }],
			},
			(text) => redactCredentials(text, [secret]),
		);
		expect(JSON.stringify(result)).not.toContain("sentinel");
		expect(result).toEqual({
			text: "value [REDACTED]",
			nested: [{ "[REDACTED]": "[REDACTED]" }],
		});
	});
});
