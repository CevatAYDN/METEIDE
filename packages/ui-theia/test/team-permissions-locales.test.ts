import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nls } from "@theia/core/lib/common/nls";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { MemberSections } from "../src/application/member-sections.js";
import { PolicyFields } from "../src/application/policy-fields.js";
import { defaultsOf } from "../src/application/section-draft.js";

const translations = (
	value: unknown,
	prefix = "",
): readonly (readonly [string, string])[] =>
	Object.entries(z.record(z.string(), z.unknown()).parse(value)).flatMap(
		([key, next]) => {
			const path = prefix ? `${prefix}/${key}` : key;
			return typeof next === "string"
				? [[path, next] as const]
				: translations(next, path);
		},
	);

it("renders new member tabs and permission fields from the actual Turkish catalog", () => {
	const catalog: unknown = JSON.parse(
		readFileSync(join(__dirname, "..", "i18n", "nls.tr.json"), "utf8"),
	);
	const previous = nls.localization;
	nls.localization = {
		languageId: "tr",
		translations: Object.fromEntries(translations(catalog)),
	};
	try {
		const tabs = renderToStaticMarkup(
			MemberSections({
				id: "member",
				selected: "tasks",
				onSelect: vi.fn(),
				member: "role",
				tasks: "work",
			}),
		);
		expect(tabs).toContain('aria-label="Üye bölümleri"');
		expect(tabs).toContain(">Üye</button>");
		expect(tabs).toContain(">Görevler</button>");
		const controls = renderToStaticMarkup(
			createElement(PolicyFields, {
				state: {
					values: {},
					defaults: defaultsOf("policy"),
					inherited: {},
					busy: false,
					dirty: false,
					readValid: true,
				},
				onField: vi.fn(),
			}),
		);
		for (const text of [
			"Önce onay isteyen eylemler",
			"Yasaklı yollar ve komutlar",
			"Yetenek bazlı onay seviyeleri",
			"Devralınan",
		])
			expect(controls).toContain(text);
		expect(controls).not.toContain("Actions that ask first");
	} finally {
		nls.localization = previous;
	}
});
