import { createHash } from "node:crypto";
import { err, ok, type SkillSourceSnapshot } from "@mete/contracts";
import { type SkillCatalogHarness, skillCatalogContract } from "@mete/testing";
import { vi } from "vitest";
import { descriptor, setup } from "./helpers/skill-catalog.js";

const text =
	"\ufeff---\r\nname: contract-catalog\r\ndescription: Independent catalog fixture\r\n---\r\nComplete catalog body.\r\n";

const open: SkillCatalogHarness = async () => {
	const source = descriptor("global", "contract-catalog");
	const snapshot: SkillSourceSnapshot = {
		source: { ...source },
		text,
		sha256: createHash("sha256")
			.update(Buffer.from(text, "utf8"))
			.digest("hex"),
	};
	const fixture = setup([source]);
	vi.mocked(fixture.source.read).mockImplementation(async (input, signal) => {
		if (signal.aborted) return err({ code: "aborted" as const });
		if (input.sourceId !== source.sourceId)
			return err({ code: "not_found" as const });
		return ok({ source: { ...source }, text, sha256: snapshot.sha256 });
	});
	return {
		adapter: fixture.catalog,
		sourceId: source.sourceId,
		snapshot,
		close: async () => {
			fixture.registration.dispose();
		},
	};
};

skillCatalogContract("catalog with attested source fixture", open);
