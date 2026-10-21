import { describe, expect, it } from "vitest";
import {
	ChatRequestSchema,
	ModelInfoSchema,
	PrivacySchema,
	ProvidersConfigSchema,
} from "../../src/domain/provider.js";

describe("ChatRequestSchema", () => {
	const req = {
		model: "m",
		messages: [
			{ role: "system", content: "be brief" },
			{
				role: "user",
				content: [
					{ type: "text", text: "what is this?" },
					{ type: "image", mediaType: "image/png", data: "iVBORw0KGgo=" },
				],
			},
			{
				role: "assistant",
				content: "",
				toolCalls: [{ id: "c1", name: "fs.read", args: { path: "a.ts" } }],
			},
			{ role: "tool", toolCallId: "c1", content: "export {}" },
		],
		tools: [{ name: "fs.read", description: "Read a file", parameters: {} }],
		maxTokens: 512,
		temperature: 0.2,
	};

	it("accepts every message role, image parts and tools", () => {
		expect(ChatRequestSchema.parse(req)).toEqual(req);
	});

	it("rejects an empty conversation, unknown roles and bad numbers", () => {
		expect(ChatRequestSchema.safeParse({ ...req, messages: [] }).success).toBe(
			false,
		);
		expect(
			ChatRequestSchema.safeParse({
				...req,
				messages: [{ role: "developer", content: "x" }],
			}).success,
		).toBe(false);
		expect(ChatRequestSchema.safeParse({ ...req, maxTokens: 0 }).success).toBe(
			false,
		);
		expect(
			ChatRequestSchema.safeParse({ ...req, temperature: -1 }).success,
		).toBe(false);
	});
});

describe("ModelInfoSchema", () => {
	const model = {
		id: "minimax/minimax-m3.1-flash:free",
		providerId: "openrouter",
		family: "minimax",
		contextWindow: 1_000_000,
		toolCalling: true,
		vision: "unknown",
		free: true,
		deprecated: false,
	};

	it("accepts known and unknown capabilities and a zero context window", () => {
		expect(ModelInfoSchema.parse(model)).toEqual(model);
		expect(
			ModelInfoSchema.safeParse({ ...model, contextWindow: 0 }).success,
		).toBe(true);
	});

	it("rejects a negative window and an unknown free flag", () => {
		expect(
			ModelInfoSchema.safeParse({ ...model, contextWindow: -1 }).success,
		).toBe(false);
		expect(
			ModelInfoSchema.safeParse({ ...model, free: "unknown" }).success,
		).toBe(false);
	});
});

describe("PrivacySchema", () => {
	it("takes true, false or unknown for each field", () => {
		const p = { trains: true, logs: "unknown", publishes: false };
		expect(PrivacySchema.parse(p)).toEqual(p);
		expect(PrivacySchema.safeParse({ ...p, logs: "maybe" }).success).toBe(
			false,
		);
	});
});

describe("ProvidersConfigSchema", () => {
	const endpoint = {
		slug: "my-lab",
		name: "My lab",
		baseUrl: "https://llm.example.test/v1",
		format: "openai-chat",
	};

	it("defaults to no endpoints and gives an endpoint empty headers", () => {
		expect(ProvidersConfigSchema.parse(undefined)).toEqual({ custom: [] });
		expect(ProvidersConfigSchema.parse({ custom: [endpoint] }).custom).toEqual([
			{ ...endpoint, headers: {} },
		]);
	});

	it("rejects a bad slug, url or format and a slug used twice", () => {
		const bad = (over: Record<string, unknown>) =>
			ProvidersConfigSchema.safeParse({ custom: [{ ...endpoint, ...over }] })
				.success;
		expect(bad({ slug: "My Lab" })).toBe(false);
		expect(bad({ baseUrl: "not a url" })).toBe(false);
		expect(bad({ format: "ollama" })).toBe(false);
		const twice = ProvidersConfigSchema.safeParse({
			custom: [endpoint, endpoint],
		});
		expect(
			twice.success ? [] : twice.error.issues.map((i) => i.path.join(".")),
		).toEqual(["custom.1.slug"]);
	});
});
