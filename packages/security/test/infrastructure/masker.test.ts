import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { maskSecrets } from "../../src/infrastructure/masker.js";

// Built at runtime so no secret-shaped literal sits in the repository.
const github = `ghp_${"A1b2C3d4E5".repeat(3)}aBcDeF`;
const privateKey = generateKeyPairSync("rsa", { modulusLength: 1024 })
	.privateKey.export({ type: "pkcs8", format: "pem" })
	.toString();
const keyBody = privateKey.split("\n")[1] ?? "";
const tag = (secret: string) =>
	`[SECRET:${createHash("sha256").update(secret).digest("hex").slice(0, 8)}]`;

describe("maskSecrets", () => {
	it("leaves text without secrets alone", async () => {
		expect(await maskSecrets("refactor the parser, keep tests green")).toEqual({
			text: "refactor the parser, keep tests green",
			masked: 0,
		});
	});

	it("replaces a token with the hash tag from tab 09", async () => {
		const r = await maskSecrets(`use ${github} for the API`);
		expect(r).toEqual({ text: `use ${tag(github)} for the API`, masked: 1 });
	});

	it("masks every secret and gives equal secrets equal tags", async () => {
		const r = await maskSecrets(`a=${github}\n${privateKey}\nb=${github}`);
		expect(r.masked).toBe(3);
		expect(r.text).not.toContain(github);
		expect(keyBody.length).toBeGreaterThan(40);
		expect(r.text).not.toContain(keyBody);
		expect(r.text.split(tag(github))).toHaveLength(3);
	});
});
