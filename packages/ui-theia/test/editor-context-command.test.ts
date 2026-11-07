import { ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import {
	type ContextTarget,
	contextScope,
} from "../src/application/context-drafts.js";
import { runEditorContextCommand } from "../src/application/editor-context-command.js";

it("captures before initializing an unfocused new composer and reveals only its accepted preview", async () => {
	let text = "selected before focus";
	let target: ContextTarget | undefined;
	const prepared: string[] = [];
	const reveal = vi.fn(async () => {});
	await runEditorContextCommand(
		{
			capture: () => ok({ path: "/w/a.ts", content: text, modified: true }),
			dir: () => "/w",
			target: () => target,
			open: async () => {},
			initial: () => {
				text = "editor after navigation";
				target = { dir: "/w", scope: contextScope("/w") };
				return Promise.resolve();
			},
			prepare: async (_scope, input) => {
				prepared.push(input.content);
				return true;
			},
			reveal,
			warn: () => {},
		},
		"selection",
	);
	expect(prepared).toEqual(["selected before focus"]);
	expect(reveal).toHaveBeenCalledWith(target);
});

it("uses the retained conversation target without resetting it and refuses late reveal after navigation", async () => {
	let target: ContextTarget | undefined = {
		dir: "/w",
		scope: contextScope("/w", "thread"),
	};
	const initial = vi.fn(async () => {});
	const reveal = vi.fn(async () => {});
	await runEditorContextCommand(
		{
			capture: () => ok({ path: "/w/a.ts", content: "fixed", modified: true }),
			dir: () => "/w",
			target: () => target,
			open: async () => {},
			initial,
			prepare: async () => {
				target = { dir: "/w", scope: contextScope("/w", "other") };
				return true;
			},
			reveal,
			warn: () => {},
		},
		"file",
	);
	expect(initial).not.toHaveBeenCalled();
	expect(reveal).not.toHaveBeenCalled();
});
