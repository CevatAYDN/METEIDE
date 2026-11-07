import type { TaskControlAnswer, TaskPending } from "@mete/contracts";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { TaskControlState } from "../src/application/task-control-session.js";
import {
	TaskControlView,
	TaskRequest,
} from "../src/application/task-control-view.js";

const id = { runId: "run", taskId: "task", requestId: "request" };
const base = {
	...id,
	templateTaskId: "write",
	title: "<Exact task>",
	worktree: "/work/task",
	branch: "mete/run/task",
};
const policy: TaskPending = {
	...base,
	kind: "policy",
	ask: {
		action: "shell.exec",
		capability: "shell.exec@1",
		adapterId: "native",
		command: "npm test",
	},
	rule: "approval required",
};
const requests: TaskPending[] = [
	policy,
	{ ...base, kind: "approval", report: "Review this report" },
	{ ...base, kind: "clarification", question: "Which output?" },
	{ ...base, kind: "blocked", reason: "Needs an instruction" },
	{ ...base, kind: "merge", message: "Resolve conflict" },
];
const state: TaskControlState = {
	phase: "ready",
	requests: [],
	busy: [],
	errors: {},
	failure: undefined,
};
const html = (next: TaskControlState) =>
	renderToStaticMarkup(
		TaskControlView({
			state: next,
			onAnswer: async () => {},
			onRefresh: () => {},
		}),
	);
it("renders exact task context and only the permitted request actions", () => {
	const labels = [
		["npm test", "Allow once", "Allow for this task"],
		["Review this report", "Approve", "Revise"],
		["Which output?", "Send answer"],
		["Needs an instruction", "Continue with feedback"],
		["Resolve conflict", "Retry merge"],
	];
	requests.forEach((request, i) => {
		const out = html({ ...state, requests: [request] });
		for (const text of labels[i] ?? []) expect(out).toContain(text);
		expect(out).toContain("&lt;Exact task&gt;");
		expect(out).toContain("/work/task");
		expect(out).toContain("mete/run/task");
		expect(out).not.toContain("Always");
	});
});
it("shows loading, unavailable, empty and per-request busy/error states", () => {
	expect(html({ ...state, phase: "loading" })).toContain(
		"Loading task decisions",
	);
	expect(html(state)).toContain("No pending task decisions");
	const failed = html({
		...state,
		phase: "failed",
		requests: [policy],
		failure: { code: "refused", detail: "not supported" },
	});
	expect(failed).toContain("not supported");
	expect(failed).toContain('disabled=""');
	const busy = html({
		...state,
		requests: [policy],
		busy: ["request"],
		errors: { request: "stale" },
	});
	expect(busy).toContain("Sending decision");
	expect(busy).toContain("stale");
	expect(busy).toContain('role="alert"');
});

type Element = React.ReactElement<{
	children?: React.ReactNode;
	onClick?: () => void;
}>;
const buttons = (node: React.ReactNode): Element[] =>
	React.Children.toArray(node).flatMap((child) => {
		if (!React.isValidElement<Element["props"]>(child)) return [];
		return child.type === "button" ? [child] : buttons(child.props.children);
	});

it("captures policy identity in each action without a latest-event lookup", () => {
	const onAnswer = vi.fn(async (_input: TaskControlAnswer) => {});
	const row = TaskRequest({ request: policy, onAnswer });
	for (const button of buttons(row)) button.props.onClick?.();
	expect(onAnswer.mock.calls.map(([input]) => input)).toEqual(
		["once", "task"].map((scope) => ({
			...id,
			decision: "allow",
			scope,
		})),
	);
});

it("explains interrupted setup without replacing the explicit feedback action", () => {
	const out = html({
		...state,
		requests: [
			{
				...base,
				kind: "blocked",
				reason: "setup_interrupted",
			},
		],
	});
	expect(out).toContain(
		"Setup was interrupted. Verify its effects before retrying.",
	);
	expect(out).not.toContain("setup_interrupted");
	expect(out).toContain("Continue with feedback");
	expect(out).toContain('name="feedback"');
	expect(out).not.toContain("Retry merge");
});
