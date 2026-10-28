import { describe, expectTypeOf, it } from "vitest";
import type { EventsReadAdapter, MeteEvent } from "../../src/index.js";

// events.read@1 (ADR-144): a reader gets the catalog union, so it can narrow each event by its type.

describe("events.read@1", () => {
	it("answers typed catalog events and the broken rows by seq", () => {
		type Read = ReturnType<EventsReadAdapter["read"]>;
		expectTypeOf<Read["events"][number]>().toEqualTypeOf<MeteEvent>();
		expectTypeOf<Read["broken"][number]>().toEqualTypeOf<{
			readonly seq: number;
			readonly issues: string;
		}>();
	});
});
