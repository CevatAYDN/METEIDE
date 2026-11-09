import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { groupsOf, searchGroups } from "../src/application/settings-groups.js";
import { SettingsView } from "../src/application/settings-view.js";

it("adds a searchable Skills group without a synthetic YAML section", () => {
	const groups = groupsOf([]);
	expect(searchGroups(groups, "skills").map((group) => group.id)).toEqual([
		"skills",
	]);
	expect(groups.find((group) => group.id === "skills")?.sections).toEqual([]);
});

it("hides YAML scope, loaded-note and Save/Apply only in Skills without changing other drafts", () => {
	const state = {
		target: "workspace" as const,
		file: "/w/.mete/gateway.yaml",
		values: { models: "free" },
		defaults: {},
		readValid: true,
		busy: false,
		dirty: true,
	};
	const none = () => {};
	const page = (group: "skills" | "models") =>
		renderToStaticMarkup(
			createElement(SettingsView, {
				model: {
					kind: "settings",
					settings: {
						loadedAt: "2026-11-08T12:00:00.000Z",
						sections: [],
						globalFile: "/g/settings.yaml",
					},
				},
				forms: {
					gateway: {
						state,
						actions: {
							onField: none,
							onSave: none,
							onClear: none,
							onTarget: none,
						},
					},
				},
				choice: { group, onGroup: none },
				actions: {
					onApply: none,
					onCommand: none,
					onOpen: none,
					onRefresh: none,
					onScope: none,
					onSaveAll: none,
				},
			}),
		);
	const skills = page("skills");
	expect(skills).toContain("Skills");
	for (const text of [
		"Apply now",
		"Save changes",
		"All folders",
		"Loaded configuration",
	])
		expect(skills).not.toContain(text);
	const models = page("models");
	expect(models).toContain("Unsaved changes: gateway");
	expect(models).toContain("Apply now");
	expect(state.dirty).toBe(true);
});
