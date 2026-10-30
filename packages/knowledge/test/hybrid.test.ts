import {
	err,
	type LlmEmbedAdapter,
	type LlmEmbedRequest,
	ok,
	type ToolContext,
} from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { NIL_RUN } from "../src/application/embed-job.js";
import { CTX, paths, setup } from "./search-setup.js";

// knowledge.search@1 with its vector source (docs/11, Hybrid search; ADR-152). The fake llm.embed@1
// is a synonym table: a vector counts a text's words of each meaning, so "compilation" lands near
// "tsc" without sharing a word with it.

const MEANINGS: readonly (readonly string[])[] = [
	["tsc", "compilation", "compiler", "build"],
	["palette", "color", "colour"],
];

const vectorOf = (text: string) => {
	const words = text.toLowerCase().split(/\W+/);
	return [
		...MEANINGS.map((m) => words.filter((w) => m.includes(w)).length),
		0.1,
	];
};

const fakeEmbed = () => {
	const calls: LlmEmbedRequest[] = [];
	const state = { answer: "ok" as "ok" | "fail" | "quota", resumesAt: "" };
	const embed: LlmEmbedAdapter = {
		embed: async (req) => {
			calls.push(req);
			if (state.answer === "fail")
				return err({ code: "network", message: "offline" });
			if (state.answer === "quota")
				return err({
					code: "quota_exhausted",
					message: "spent",
					resumesAt: state.resumesAt,
				});
			const model = { providerId: "fake", modelId: "embed-1" };
			return ok({ vectors: req.input.map(vectorOf), model });
		},
	};
	const documents = () => calls.filter((c) => c.purpose === "document");
	return { calls, state, embed, documents };
};

const lesson = (body: string) => `---\ntype: lesson\n---\n\n${body}\n`;

describe("knowledge.search@1 with the vector source", () => {
	it("finds a section by meaning, once the background job has embedded it", async () => {
		const e = fakeEmbed();
		const s = await setup({ embed: e.embed });
		await s.note(
			"lessons/build.md",
			lesson("The tsc step failed on an import."),
		);
		await s.note("lessons/colors.md", lesson("Pick a palette for the page."));
		expect(paths(await s.search({ query: "compilation" }))).toEqual([]);
		await vi.waitFor(() => expect(e.documents()).toHaveLength(1));
		const r = await s.search({ query: "compilation" });
		expect(paths(r)).toEqual(["lessons/build.md", "lessons/colors.md"]);
		expect(r.ok && r.value.results[0]).toMatchObject({
			snippet: "The tsc step failed on an import.",
			sources: {},
		});
		const query = e.calls.filter((c) => c.purpose === "query");
		expect(query.map((c) => [c.runId, c.priority])).toEqual([["r1", 1]]);
		expect(e.documents()[0]).toMatchObject({ runId: NIL_RUN, priority: 2 });
		const { runId: _r, ...noRun } = CTX;
		await s.search({ query: "compilation" }, noRun as ToolContext);
		expect(e.calls.at(-1)).toMatchObject({ runId: NIL_RUN, priority: 0 });
		await s.close();
	});

	it("ranks first a section both sources found, with its keyword rank", async () => {
		const e = fakeEmbed();
		const s = await setup({ embed: e.embed });
		await s.note("lessons/x.md", lesson("The tsc step failed."));
		await s.note("lessons/y.md", lesson("Compilation broke again."));
		await s.note("lessons/z.md", lesson("Pick a palette."));
		await s.search({ query: "tsc" });
		await vi.waitFor(() => expect(e.documents()).toHaveLength(1));
		const r = await s.search({ query: "tsc" });
		expect(paths(r)).toEqual(["lessons/x.md", "lessons/y.md", "lessons/z.md"]);
		expect(r.ok && r.value.results.map((h) => h.sources)).toEqual([
			{ keyword: 1 },
			{},
			{},
		]);
		await s.close();
	});

	it("answers with the keyword source alone when the query's embedding fails", async () => {
		const e = fakeEmbed();
		const s = await setup({ embed: e.embed });
		await s.note("lessons/x.md", lesson("The tsc step failed."));
		await s.note("lessons/y.md", lesson("Compilation broke again."));
		await s.search({ query: "tsc" });
		await vi.waitFor(() => expect(e.documents()).toHaveLength(1));
		e.state.answer = "fail";
		expect(paths(await s.search({ query: "tsc" }))).toEqual(["lessons/x.md"]);
		await s.close();
	});

	it("stops the background embedding until quota_exhausted's resumesAt", async () => {
		const e = fakeEmbed();
		let now = Date.parse("2026-10-30T12:00:00.000Z");
		const s = await setup({ embed: e.embed, now: () => now });
		e.state.answer = "quota";
		e.state.resumesAt = new Date(now + 60_000).toISOString();
		await s.note("lessons/x.md", lesson("The tsc step failed."));
		await s.search({ query: "tsc" });
		await vi.waitFor(() => expect(e.documents()).toHaveLength(1));
		e.state.answer = "ok";
		await s.search({ query: "tsc" });
		await new Promise((r) => setTimeout(r, 20));
		expect(e.documents()).toHaveLength(1);
		now += 60_000;
		await s.search({ query: "tsc" });
		await vi.waitFor(() => expect(e.documents()).toHaveLength(2));
		await s.close();
	});

	it("never sends a private or ignored note, and embeds a text once", async () => {
		const e = fakeEmbed();
		const s = await setup({ embed: e.embed });
		await s.note("lessons/a.md", "---\nprivate: true\n---\nsecret tsc build");
		await s.note("decisions/b.md", "hidden tsc build");
		s.hidden.add(".mete/knowledge/decisions/b.md");
		await s.note("lessons/c.md", lesson("same tsc text"));
		await s.note("lessons/d.md", lesson("same tsc text"));
		await s.search({ query: "tsc" });
		await vi.waitFor(() => expect(e.documents()).toHaveLength(1));
		await s.search({ query: "tsc" });
		await new Promise((r) => setTimeout(r, 20));
		expect(e.documents().map((c) => c.input)).toEqual([["same tsc text"]]);
		await s.close();
	});
});
