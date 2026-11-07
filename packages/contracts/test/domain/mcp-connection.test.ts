import { describe, expect, it } from "vitest";
import {
	McpConnectionRequestSchema,
	McpConnectionStateSchema,
	McpCredentialWriteSchema,
	RegistrySetupResultSchema,
} from "../../src/domain/mcp-connection.js";

const expected = {
	id: "remote",
	transport: "streamable-http",
	url: "https://example.test/mcp",
	auth: "none",
};
const field = {
	kind: "header",
	name: "X-Api-Key",
	required: true,
	secret: true,
};

describe("explicit MCP management", () => {
	it("requires an exact target and an attempt id for cancellation", () => {
		expect(
			McpConnectionRequestSchema.safeParse({ op: "status", expected }).success,
		).toBe(true);
		expect(
			McpConnectionRequestSchema.safeParse({ op: "cancel", expected }).success,
		).toBe(false);
		expect(
			McpConnectionRequestSchema.safeParse({ op: "start", id: "remote" })
				.success,
		).toBe(false);
	});

	it("never accepts secrets or browser URLs in a status response", () => {
		const state = {
			id: "remote",
			identity: "a".repeat(64),
			phase: "untested",
			fields: [],
		};
		expect(McpConnectionStateSchema.safeParse(state).success).toBe(true);
		for (const extra of [
			{ access_token: "secret" },
			{ authorizationUrl: "https://x.test" },
		])
			expect(
				McpConnectionStateSchema.safeParse({ ...state, ...extra }).success,
			).toBe(false);
	});

	it("validates field names, exact values and OAuth authorization conflicts", () => {
		const input = {
			expected,
			fields: [field],
			values: { "header:X-Api-Key": "sentinel" },
		};
		expect(McpCredentialWriteSchema.safeParse(input).success).toBe(true);
		expect(
			McpCredentialWriteSchema.safeParse({
				...input,
				values: { extra: "secret" },
			}).success,
		).toBe(false);
		expect(
			McpCredentialWriteSchema.safeParse({
				...input,
				values: { "header:X-Api-Key": "a\r\nb" },
			}).success,
		).toBe(false);
		expect(
			McpCredentialWriteSchema.safeParse({
				expected: { ...expected, auth: "oauth" },
				fields: [{ ...field, name: "Authorization" }],
				values: { "header:Authorization": "secret" },
			}).success,
		).toBe(false);
	});

	it("keeps registry setup separate from legacy preparation", () => {
		const draft = {
			server: expected,
			notes: [],
			source: "org/server",
			fields: [field],
			blocked: false,
		};
		expect(RegistrySetupResultSchema.safeParse(draft).success).toBe(true);
		expect(
			RegistrySetupResultSchema.safeParse({ ...draft, secret: "value" })
				.success,
		).toBe(false);
	});

	it("does not allow persisted requirements to be downgraded by credential submission", () => {
		const input = {
			expected: { ...expected, credentialFields: [field] },
			fields: [{ ...field, secret: false }],
			values: { "header:X-Api-Key": "sentinel" },
		};
		expect(McpCredentialWriteSchema.safeParse(input).success).toBe(false);
	});
});
