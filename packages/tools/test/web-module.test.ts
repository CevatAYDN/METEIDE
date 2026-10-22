import { ok, type SecretStore } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createToolsWebModule, searchKeyName } from "../src/web-module.js";
import { toolContext } from "./helpers/context.js";

const secretsWith = (values: Record<string, string>): SecretStore => ({
	get: async (name) => ok(values[name]),
	set: async () => ok(undefined),
	delete: async () => ok(false),
});

describe("tools-web", () => {
	it("provides web.fetch@1 always and web.search@1 only with a Tavily key", async () => {
		const without = toolContext("allow");
		const warned: string[] = [];
		const ctx = {
			...without.ctx,
			secrets: secretsWith({}),
			logger: {
				...without.ctx.logger,
				warn: (_: unknown, msg: string) => warned.push(msg),
			},
		};
		expect((await createToolsWebModule().activate(ctx)).ok).toBe(true);
		expect(without.registry.has("web.fetch@1")).toBe(true);
		expect(without.registry.has("web.search@1")).toBe(false);
		expect(warned).toEqual(["Tavily web.search@1 adapter not provided"]);

		const keyed = toolContext("allow");
		const secrets = secretsWith({ [searchKeyName("tavily")]: "tvly-x" });
		await createToolsWebModule().activate({ ...keyed.ctx, secrets });
		const chain = keyed.registry.resolve("web.search@1");
		expect(chain.ok && chain.value.map((a) => a.id)).toEqual(["tavily"]);
	});
});
