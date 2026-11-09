import { createHash, generateKeyPairSync } from "node:crypto";
import { type SkillInspection, SkillMetadataSchema } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import {
	captureSkillReaders,
	maskSkillInspection,
} from "../../src/application/skill-readers.js";
import { maskSecrets } from "../../src/infrastructure/masker.js";
import { skillFixture } from "../helpers/skill-readers.js";

const setup = (frontmatter: string, body = "# Body\r\nKeep  spacing.\r\n") => {
	const f = skillFixture();
	const text = `\uFEFF---\r\n${frontmatter}---\r\n${body}`;
	const inspection: SkillInspection = {
		source: { ...f.inspection.source, path: "review/SKILL.md" },
		text,
		sha256: createHash("sha256").update(text, "utf8").digest("hex"),
		metadata: SkillMetadataSchema.parse(parseDocument(frontmatter).toJS()),
	};
	const readers = captureSkillReaders(f.options);
	if (!readers.ok) throw new Error("Fixture readers missing");
	const mask = (signal = new AbortController().signal) =>
		maskSkillInspection(readers.value, inspection, signal);
	return { ...f, inspection, mask };
};

describe("complete skill preview masking", () => {
	it("masks a generated CRLF PEM in JSON-quoted YAML without rewriting its surroundings", async () => {
		const pem = generateKeyPairSync("rsa", { modulusLength: 1024 })
			.privateKey.export({ type: "pkcs8", format: "pem" })
			.toString()
			.trim()
			.replaceAll("\n", "\r\n");
		const encoded = JSON.stringify(pem);
		const f = setup(
			`# Keep this comment\r\nname: review\r\ndescription: ${encoded} # Keep inline\r\nlicense: 'MIT'\r\n`,
		);
		f.adapters.masker.impl.mask = maskSecrets;
		const result = await f.mask();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.metadata.description).toMatch(
			/^\[SECRET:[a-f0-9]{8}\]$/,
		);
		const keyBody = pem.split("\r\n")[1] ?? "";
		expect(keyBody.length).toBeGreaterThan(40);
		expect(JSON.stringify(result.value)).not.toContain(keyBody);
		expect(result.value.text).toBe(
			f.inspection.text.replace(
				encoded,
				JSON.stringify(result.value.metadata.description),
			),
		);
		expect(result.value.sha256).toBe(f.inspection.sha256);
		expect(
			createHash("sha256").update(result.value.text).digest("hex"),
		).not.toBe(result.value.sha256);
	});

	it("masks escaped pair keys/values and folded scalars while retaining safe syntax", async () => {
		const f = setup(
			'name: review\r\ndescription: "\\u0073ecret"\r\ncompatibility: >- # Keep header\r\n  secret\r\nmetadata: { "\\x73ecret": "\\u0073ecret", safe: \'unchanged\' }\r\n',
			"Body secret.\r\n",
		);
		const result = await f.mask();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.text).toBe(
			'\uFEFF---\r\nname: review\r\ndescription: "masked"\r\ncompatibility: "masked" # Keep header\r\nmetadata: { "masked": "masked", safe: \'unchanged\' }\r\n---\r\nBody masked.\r\n',
		);
		expect(JSON.stringify(result.value)).not.toContain("\\u0073");
		expect(result.value.metadata.metadata).toEqual({
			masked: "masked",
			safe: "unchanged",
		});
		expect(result.value.sha256).toBe(f.inspection.sha256);
	});

	it("leaves secret-free BOM, CRLF, quoting, comments and body bytes unchanged", async () => {
		const f = setup(
			"# Keep\r\nname: review\r\ndescription: \"Useful  work\" # Inline\r\nlicense: 'MIT'\r\ncompatibility: |-\r\n  portable\r\n",
		);
		f.adapters.masker.impl.mask = maskSecrets;
		const result = await f.mask();
		expect(result).toEqual({ ok: true, value: f.inspection });
	});

	it.each([
		'name: review\ndescription: "unclosed\n',
		"name: review\ndescription: first\ndescription: second\n",
		"name: review\ndescription: &shared secret\nlicense: *shared\n",
	])(
		"refuses malformed or referenced raw YAML without repairing it",
		async (raw) => {
			const f = setup("name: review\ndescription: secret\n");
			f.inspection.text = `---\n${raw}---\nBody\n`;
			expect(await f.mask()).toEqual({
				ok: false,
				error: { code: "unavailable" },
			});
		},
	);

	it.each(["throw", "invalid", "cancel", "replace"] as const)(
		"fails closed when full-text masking encounters %s",
		async (failure) => {
			const f = setup('name: review\ndescription: "\\u0073ecret"\n');
			const controller = new AbortController();
			const original = f.adapters.masker.impl.mask;
			const faults = {
				throw: () => {
					throw new Error("Unsafe adapter text");
				},
				invalid: () => ({ text: "", masked: 1 }),
				cancel: () => controller.abort(),
				replace: () => {
					Object.assign(f.adapters.masker, {
						impl: { ...f.adapters.masker.impl },
					});
				},
			};
			f.adapters.masker.impl.mask = async (text) => {
				if (!text.startsWith("\uFEFF---")) return original(text);
				return faults[failure]() ?? original(text);
			};
			expect(await f.mask(controller.signal)).toEqual({
				ok: false,
				error: {
					code:
						failure === "cancel"
							? "aborted"
							: failure === "replace"
								? "stale"
								: "unavailable",
				},
			});
		},
	);
});
