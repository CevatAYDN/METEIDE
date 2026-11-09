import { err, type MeteEvent, ok } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW, type TeamView } from "@mete/ui-studio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ChatBoard } from "../src/application/chat-board.js";
import { createModelSession } from "../src/application/model-session.js";
import type { RunFacts } from "../src/application/run-hero.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

const render = (
	run: RunFacts,
	view: TeamView = EMPTY_TEAM_VIEW,
	feed: readonly MeteEvent[] = [],
	preferredModels?: Readonly<Record<string, string>>,
) =>
	renderToStaticMarkup(
		createElement(ChatBoard, {
			model: { goal: "Review this project", view, feed },
			controls: {
				run,
				...(preferredModels ? { preferredModels } : {}),
				names: {},
				windows: {},
				transcript: {},
				waiting: {
					onResume: () => {},
					onApprove: () => {},
					onRevise: () => {},
					onShowFiles: () => {},
				},
				onOpenReport: () => {},
				markdown: {
					render: () => {
						throw new Error("browser only");
					},
				},
				onReply: async () => undefined,
				tools: createElement("button", { type: "button" }, "Tools"),
				restore: { onRestore: () => {} },
			},
			details: "Model selection",
		}),
	);

it("replaces the large run hero with a compact status and collapsed metrics", () => {
	const out = render({});
	expect(out).toContain('class="mete-chat-header"');
	expect(out).not.toContain('class="mete-hero"');
	expect(out).toContain('<details class="mete-chat-details"><summary>');
	expect(out).toContain("<dt>Calls</dt>");
	expect(out).not.toMatch(/<details[^>]* open/);
	expect(out.indexOf("<dt>Calls</dt>")).toBeGreaterThan(
		out.indexOf("<details"),
	);
	expect(out.indexOf("Model selection")).toBeLessThan(out.indexOf("<form"));
	expect(out.indexOf(">Tools<")).toBeGreaterThan(out.indexOf("<form"));
});

it("keeps resume outside the closed diagnostic disclosure", () => {
	const out = render({
		run: {
			id: "run",
			workspaceId: "workspace",
			templateId: null,
			goal: "Review this project",
			status: "paused",
			pauseReason: "user",
			autonomyLevel: 1,
			budget: { cloudRequests: 10, maxHours: 1 },
			createdAt: "2026-11-07T10:00:00Z",
		},
	});
	expect(out).toContain("Paused");
	expect(out).toContain(">Resume<");
	expect(out.indexOf(">Resume<")).toBeLessThan(out.indexOf("<details"));
});

const RUN: NonNullable<RunFacts["run"]> = {
	id: "run",
	workspaceId: "workspace",
	templateId: null,
	goal: "Review this project",
	status: "completed",
	autonomyLevel: 1,
	budget: { cloudRequests: 10, maxHours: 1 },
	createdAt: "2026-11-07T10:00:00Z",
};

const created = (
	overrides: Partial<Extract<MeteEvent, { type: "agent.created" }>> = {},
): Extract<MeteEvent, { type: "agent.created" }> => ({
	id: "created",
	type: "agent.created",
	schema: 1,
	source: "core-engine",
	workspaceId: "workspace",
	runId: "run",
	agentId: "assistant",
	ts: "2026-11-07T10:00:01Z",
	payload: { roleId: "assistant", providerId: "first", modelId: "original" },
	...overrides,
});

const changed = (
	reason: "quota" | "failed",
): Extract<MeteEvent, { type: "agent.model.changed" }> => ({
	id: "changed",
	type: "agent.model.changed",
	schema: 1,
	source: "core-engine",
	workspaceId: "workspace",
	runId: "run",
	agentId: "assistant",
	ts: "2026-11-07T10:00:03Z",
	payload: {
		from: { providerId: "first", modelId: "original" },
		to: { providerId: "fallback", modelId: "replacement" },
		reason,
	},
});

const header = (out: string) =>
	out.slice(out.indexOf("<header"), out.indexOf("</header>"));

it("shows the created model outside diagnostics even without feed or run metadata", () => {
	const view = applyAll("run", EMPTY_TEAM_VIEW, [created()]);
	const out = render({}, view);
	expect(header(out)).toContain("Last model: first/original");
	expect(header(out)).not.toContain("Preferred model:");
	expect(header(out)).not.toContain("Model selection: Automatic");
	expect(out.indexOf("Last model:")).toBeLessThan(out.indexOf("<details"));
});

it.each(["quota", "failed"] as const)(
	"shows the folded %s fallback rather than the preference or previous usage",
	(reason) => {
		const ended: MeteEvent = {
			id: "ended",
			type: "agent.thinking.ended",
			schema: 1,
			source: "core-engine",
			workspaceId: "workspace",
			runId: "run",
			agentId: "assistant",
			ts: "2026-11-07T10:00:02Z",
			payload: { usage: { prompt: 10, completion: 2 } },
		};
		const view = applyAll("run", EMPTY_TEAM_VIEW, [
			created(),
			ended,
			changed(reason),
		]);
		const out = render(
			{
				run: { ...RUN, prefer: { providerId: "chosen", modelId: "desired" } },
			},
			view,
		);
		expect(header(out)).toContain("Last model: fallback/replacement");
		expect(header(out)).toContain("Preferred model: chosen/desired");
		expect(header(out)).not.toContain("Last model: first/original");
		expect(header(out)).not.toContain("Last model: chosen/desired");
		expect(header(out)).not.toMatch(/inherited/i);
	},
);

it("does not report a preferred model as observed when there are no agent events", () => {
	const prefer = { providerId: "chosen", modelId: "desired" };
	const out = header(render({ run: { ...RUN, prefer } }));
	expect(out).toContain("Last model: Not reported");
	expect(out).toContain("Preferred model: chosen/desired");
	expect(out).not.toContain("Model selection: Automatic");
	expect(out).not.toContain("Last model: chosen/desired");
});

it.each(["single", "assistant"])(
	"does not infer a single-agent preference from a team-role map keyed %s",
	(role) => {
		const prefer = { [role]: { providerId: "chosen", modelId: "desired" } };
		const out = header(render({ run: { ...RUN, prefer } }));
		expect(out).toContain("Last model: Not reported");
		expect(out).not.toContain("Preferred model:");
		expect(out).not.toContain("Model selection: Automatic");
	},
);

it("reports automatic selection only when the run metadata is known", () => {
	expect(header(render({ run: RUN }))).toContain("Model selection: Automatic");
	expect(header(render({ run: RUN }))).toContain("Last model: Not reported");
	expect(header(render({}))).not.toContain("Model selection: Automatic");
});

it("refuses ambiguous assistant evidence instead of choosing by created order", () => {
	const view = applyAll("run", EMPTY_TEAM_VIEW, [
		created(),
		created({ id: "second", agentId: "second" }),
		changed("quota"),
	]);
	const out = header(render({ run: RUN }, view));
	expect(out).toContain("Last model: Not reported");
	expect(out).not.toContain("fallback/replacement");
});

it("ignores other roles and task-bound assistants when selecting model evidence", () => {
	const other = created({
		id: "other",
		agentId: "other",
		payload: { roleId: "reviewer", providerId: "other", modelId: "other" },
	});
	const task = created({ id: "task", agentId: "task", taskId: "task" });
	const unrelated = applyAll("run", EMPTY_TEAM_VIEW, [other, task]);
	expect(header(render({ run: RUN }, unrelated))).toContain(
		"Last model: Not reported",
	);
	const view = applyAll("run", unrelated, [created()]);
	expect(header(render({ run: RUN }, view))).toContain(
		"Last model: first/original",
	);
});

it("keeps a displayed historical run's model without leaking a newer run's feed", () => {
	const historical = created({ runId: "history" });
	const newer = changed("quota");
	const view = applyAll("history", EMPTY_TEAM_VIEW, [
		historical,
		created(),
		newer,
	]);
	const out = header(render({ run: { ...RUN, id: "history" } }, view, [newer]));
	expect(out).toContain("Last model: first/original");
	expect(out).not.toContain("fallback/replacement");
});

it("keeps long model identities as escaped wrapping text without adding controls", () => {
	const providerId = '<provider&"name">';
	const modelId = `${"long-model".repeat(60)}<script>bad</script>`;
	const view = applyAll("run", EMPTY_TEAM_VIEW, [
		created({ payload: { roleId: "assistant", providerId, modelId } }),
	]);
	const out = header(
		render({ run: { ...RUN, prefer: { providerId, modelId } } }, view),
	);
	expect(out).toContain('class="mete-chat-model"');
	expect(out).toContain(
		`Last model: &lt;provider&amp;&quot;name&quot;&gt;/${"long-model".repeat(60)}`,
	);
	expect(out).toContain(
		"Preferred model: &lt;provider&amp;&quot;name&quot;&gt;",
	);
	expect(out).toContain("&lt;script&gt;bad&lt;/script&gt;");
	expect(out).not.toContain("<script>");
	expect(out).not.toMatch(/<(button|input|select)\b/);
});

const selectionSession = (run: NonNullable<RunFacts["run"]>) => {
	const model = vi.fn<MeteDaemonService["model"]>().mockResolvedValue(ok(null));
	const session = createModelSession({
		daemon: { model } as unknown as MeteDaemonService,
		onChange: () => {},
		warn: () => {},
	});
	session.show("/workspace", run.id);
	session.onRun(run, "assistant");
	return { session, model };
};

it("follows acknowledged preference changes and clears without another run event", async () => {
	const run = { ...RUN, status: "paused", pauseReason: "user" } as const;
	const { session, model } = selectionSession(run);
	const pending =
		Promise.withResolvers<Awaited<ReturnType<MeteDaemonService["model"]>>>();
	model.mockImplementationOnce(() => pending.promise);
	const view = applyAll("run", EMPTY_TEAM_VIEW, [created()]);
	const draw = () => header(render({ run }, view, [], session.preferred));
	const change = session.setModel("assistant", {
		providerId: "chosen",
		modelId: "desired",
	});
	expect(draw()).toContain("Model selection: Automatic");
	pending.resolve(ok(null));
	await change;
	expect(draw()).toContain("Preferred model: chosen/desired");
	expect(draw()).toContain("Last model: first/original");
	await session.setModel("assistant", null);
	expect(draw()).toContain("Model selection: Automatic");
	expect(draw()).not.toContain("Preferred model:");
	expect(draw()).toContain("Last model: first/original");
});

it("clears a saved preference without falling back to unchanged run metadata", async () => {
	const run = {
		...RUN,
		status: "paused",
		pauseReason: "user",
		prefer: { providerId: "saved", modelId: "original" },
	} as const;
	const { session } = selectionSession(run);
	await session.setModel("assistant", null);
	const out = header(render({ run }, EMPTY_TEAM_VIEW, [], session.preferred));
	expect(out).toContain("Model selection: Automatic");
	expect(out).not.toContain("Preferred model:");
	expect(out).not.toContain("saved/original");
});

it("keeps the previous preference after a refused change", async () => {
	const run = {
		...RUN,
		status: "paused",
		pauseReason: "user",
		prefer: { providerId: "kept", modelId: "original" },
	} as const;
	const { session, model } = selectionSession(run);
	model.mockResolvedValue(err({ code: "stopped", detail: "fixture" }));
	await session.setModel("assistant", {
		providerId: "refused",
		modelId: "choice",
	});
	const out = header(render({ run }, EMPTY_TEAM_VIEW, [], session.preferred));
	expect(out).toContain("Preferred model: kept/original");
	expect(out).not.toContain("refused/choice");
});

it("does not apply an old run's model acknowledgment after navigation", async () => {
	const { session, model } = selectionSession(RUN);
	const pending =
		Promise.withResolvers<Awaited<ReturnType<MeteDaemonService["model"]>>>();
	model.mockImplementationOnce(() => pending.promise);
	const change = session.setModel("assistant", {
		providerId: "old",
		modelId: "choice",
	});
	const next = { ...RUN, id: "another-run" };
	session.show("/other-workspace", next.id);
	session.onRun(next, "assistant");
	pending.resolve(ok(null));
	await change;
	const out = header(
		render({ run: next }, EMPTY_TEAM_VIEW, [], session.preferred),
	);
	expect(out).toContain("Model selection: Automatic");
	expect(out).not.toContain("old/choice");
});
