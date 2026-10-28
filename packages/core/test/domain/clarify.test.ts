import { describe, expect, it } from "vitest";
import { summaryOf } from "../../src/domain/clarify.js";

describe("an answer's summary (ADR-142)", () => {
	it("takes the first sentence of the first line, past a list marker, cut to 80 characters", () => {
		expect(summaryOf("Ankara. The brief names it.")).toBe("Ankara.");
		expect(summaryOf("1. Prices run 70 TL. Sources follow.\n2. None.")).toBe(
			"Prices run 70 TL.",
		);
		expect(summaryOf("- **Espresso:** 85 TL\n- Latte: 95 TL")).toBe(
			"**Espresso:** 85 TL",
		);
		expect(summaryOf(`${"a".repeat(100)}.`)).toHaveLength(80);
	});
});
