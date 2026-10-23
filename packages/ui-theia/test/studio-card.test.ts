import type { AgentCard, Character, TaskCard } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioCard, stateText } from "../src/application/studio-card.js";

// The card a click on a Studio character opens, rendered to HTML on Node (docs/13, Interaction).

const agent = (id: string, taskId?: string): AgentCard => ({
	id,
	roleId: "developer",
	providerId: "groq",
	modelId: `model-${id}`,
	thinking: false,
	...(taskId ? { taskId } : {}),
});
const TASKS: TaskCard[] = [
	{
		id: "build",
		title: "Build the page",
		roleId: "developer",
		dependsOn: [],
		status: "in_progress",
	},
];
const ch = (more: Partial<Character> = {}): Character => ({
	id: "a1",
	roleId: "developer",
	count: 1,
	state: "idle",
	...more,
});
const html = (character: Character, agents: AgentCard[]) =>
	renderToStaticMarkup(
		createElement(StudioCard, {
			character,
			agents,
			tasks: TASKS,
			place: { x: 100, y: 200, under: false },
			onClose: () => {},
		}),
	);

describe("StudioCard", () => {
	it("is a labelled dialog with the role, the status, and the agent's provider, model and task", () => {
		const out = html(ch(), [agent("a1", "build")]);
		expect(out).toContain('role="dialog"');
		expect(out).toContain('aria-label="developer"');
		for (const text of ["Status", "Idle", "groq", "model-a1", "Build the page"])
			expect(out).toContain(text);
	});

	it("lists every agent of a group, with the group's size, and says None for an agent without a task", () => {
		const out = html(ch({ id: "developer", count: 2 }), [
			agent("a1", "build"),
			agent("a2"),
		]);
		expect(out).toContain("developer ×2");
		expect(out.match(/>Provider</g)).toHaveLength(2);
		expect(out).toContain("model-a2");
		expect(out).toContain("None");
	});

	it("opens under the head near the room's top and above it elsewhere", () => {
		const at = (under: boolean) =>
			renderToStaticMarkup(
				createElement(StudioCard, {
					character: ch(),
					agents: [],
					tasks: [],
					place: { x: 0, y: 0, under },
					onClose: () => {},
				}),
			);
		expect(at(true)).toContain("translate(-50%, 16px)");
		expect(at(false)).toContain("translate(-50%, calc(-100% - 12px))");
	});
});

describe("stateText", () => {
	it("words each state the room draws", () => {
		expect(stateText(ch({ state: "thinking" }))).toBe("Thinking");
		expect(stateText(ch({ state: "working", tool: "fs.read@1" }))).toBe(
			"Working with fs.read@1",
		);
		expect(stateText(ch({ state: "working" }))).toBe("Working");
		expect(stateText(ch({ state: "waiting" }))).toBe("Waiting for quota");
		expect(
			stateText(ch({ state: "waiting", resetsAt: "2026-10-24T09:30:00.000Z" })),
		).toMatch(/^Waiting for quota until \d/);
	});
});
