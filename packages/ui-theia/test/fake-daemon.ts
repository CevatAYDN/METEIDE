import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvedSkill, skillList, skillPreview } from "./skill-fixture.js";
import { verificationFixture } from "./verification-fixture.js";

// A script that speaks the daemon protocol like `mete daemon`, run by a real Node child, so the host
// is tested over real pipes without Electron or @mete/cli. The mode (argv 3) picks its behaviour.

const jsonrpc = createRequire(__filename).resolve("vscode-jsonrpc/node");

const SCRIPT = `
const { createMessageConnection, StreamMessageReader, StreamMessageWriter, ResponseError } = require(${JSON.stringify(jsonrpc)});
const [, , dir, mode] = process.argv;
if (mode === "exit") {
	process.stderr.write("no provider key for " + dir + "\\n");
	process.exit(1);
}
const run = { id: "6f1c3d52-9b7e-4a52-8d5f-0a1b2c3d4e5f", workspaceId: "0b6f0a43-3f0e-4a3e-9a58-1b2c3d4e5f60", templateId: null, goal: "fix it", status: "paused", pauseReason: "quota", autonomyLevel: 2, budget: { cloudRequests: 10, maxHours: 1 }, createdAt: "2026-10-23T10:00:00.000Z" };
const conn = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
const skillSession = require("node:crypto").randomUUID();
conn.onRequest("mete/skills.runtime", () => ({ ok: true, value: {
	sessionId: skillSession, catalog: { status: "ready", entries: [], diagnostics: [] }
} }));
conn.onRequest("mete/run.skills.read", (p) => ({
	ok: true, value: { kind: "legacy", runId: p.runId }
}));
conn.onRequest("mete/skills.list", () => {
	const list = ${JSON.stringify(skillList)};
	list.value.sessionId = skillSession;
	return mode === "skills-list-bad" ? { ...list, extra: true } : list;
});
conn.onRequest("mete/skills.prepare", (p) => {
	if (p.sessionId !== skillSession) return { ok: false, error: { code: "stale" } };
	const preview = ${JSON.stringify(skillPreview)};
	preview.value.sessionId = skillSession;
	preview.value.expiresAt = new Date(Date.now() + 300000).toISOString();
	return mode === "skills-preview-bad" ? { ...preview, extra: true } : preview;
});
const mutateSkill = (p) => {
	if (p.sessionId !== skillSession) return { admitted: false, result: { ok: false, error: { code: "stale" } } };
	if (mode === "skills-lost") process.exit(1);
	if (mode === "skills-busy" || mode === "one") return { admitted: false, result: { ok: false, error: { code: "busy" } } };
	if (mode === "skills-malformed") return { result: { ok: true, value: ${JSON.stringify(approvedSkill)} } };
	return { admitted: true, result: mode === "skills-admitted-error"
		? { ok: false, error: { code: "storage_failed" } }
		: { ok: true, value: ${JSON.stringify(approvedSkill)} } };
};
conn.onRequest("mete/skills.approve", mutateSkill);
conn.onRequest("mete/skills.disable", mutateSkill);
conn.onRequest("mete/task.verification", (p) => {
	if (p.runId !== ${JSON.stringify("11111111-1111-4111-8111-111111111111")}) throw new ResponseError(-32000, "wrong verification run", { code: "not_found" });
	if (mode === "notready") throw new ResponseError(-32000, "core-engine unavailable", { code: "not_ready", reasons: ["core-engine unavailable"] });
	if (mode === "no-verification") throw new ResponseError(-32601, "verification unavailable");
	if (mode === "legacy-verification") return { mode: "legacy", tasks: [] };
	const evidence = ${JSON.stringify(verificationFixture)};
	if (mode === "bad-verification") return { ...evidence, extra: true };
	if (mode === "bad-gate-verification") evidence.tasks[0].evaluations[0].gates[0].reason = "interrupted";
	return evidence;
});
conn.onRequest("mete/daemon.quiesce", () => {
	if (mode === "one") throw new ResponseError(-32000, "work is active", { code: "failed" });
	return null;
});
conn.onRequest("mete/status", (p) => {
	if (mode === "notready") throw new ResponseError(-32000, "core-engine is not active", { code: "not_ready", reasons: ["core-engine is not active.", "Add a provider key with: mete key set openrouter"] });
	if (mode === "events") {
		const at = new Date().toISOString();
		const base = { schema: 1, workspaceId: run.workspaceId, runId: run.id, source: "core-engine", ts: at };
		conn.sendNotification("mete/event", { ...base, id: "7c1d3e52-9b7e-4a52-8d5f-0a1b2c3d4e51", type: "run.created", payload: { templateId: null, goal: "g" } });
		conn.sendNotification("mete/event", { ...base, id: "7c1d3e52-9b7e-4a52-8d5f-0a1b2c3d4e52", type: "run.started", payload: {} });
		conn.sendNotification("mete/event", { ...base, id: "x", type: "run.started", payload: {} });
	}
	if (p && p.runId === "baddata") throw new ResponseError(-32000, "odd", { oops: 1 });
	if (p && p.runId === "die") process.exit(1);
	if (p && p.runId === "refuse") throw new ResponseError(-32000, "run not found", { code: "not_found" });
	if (p && p.runId === "garbage") return [{ nope: 1 }];
	return mode === "one" ? [run] : [];
});
conn.onRequest("mete/run.reply", (p) => p.runId === "garbage" ? { runId: "" } : { runId: p.message });
conn.onRequest("mete/task.pending", (p) => {
	if (mode === "notasks") throw new ResponseError(-32000, "task.control@1 is not active", { code: "not_supported" });
	if (mode === "badtasks") return { requests: [], extra: true };
	return { requests: [{ runId: p.runId, taskId: "22222222-2222-4222-8222-222222222222", requestId: "33333333-3333-4333-8333-333333333333",
		templateTaskId: "write", title: "Write", kind: "approval" }] };
});
conn.onRequest("mete/task.answer", (p) => {
	if (mode === "notasks") throw new ResponseError(-32000, "task.control@1 is not active", { code: "not_supported" });
	if (p.runId !== "11111111-1111-4111-8111-111111111111" || p.taskId !== "22222222-2222-4222-8222-222222222222" || p.requestId !== "33333333-3333-4333-8333-333333333333")
		throw new ResponseError(-32000, "stale request", { code: "bad_input" });
	return mode === "badtasks" ? {} : null;
});
conn.onRequest("mete/conversation.start", (p) => p.goal === "garbage" ? { runId: "" } : { runId: p.goal + ":" + p.capabilities.join(",") });
conn.onRequest("mete/conversation.reply", (p) => p.runId === "garbage" ? { runId: "" } : { runId: p.message + ":" + JSON.stringify(p.capabilities) });
conn.onRequest("mete/thread.start", (p) => p.goal === "garbage" ? {} : { conversationId: p.requestId, runId: p.requestId });
conn.onRequest("mete/thread.reply", (p) => ({ conversationId: p.conversationId, runId: p.expectedRunId }));
conn.onRequest("mete/thread.list", () => ({ conversations: [] }));
conn.onRequest("mete/thread.read", (p) => {
	const head = { ...run, id: p.runId };
	return { conversation: { id: p.runId, title: head.goal, head, createdAt: head.createdAt, updatedAt: head.createdAt, turnCount: 1 }, turns: [head] };
});
conn.onRequest("mete/registry.search", (p) => p.query === "odd" ? { entries: [{}] } : {
	entries: [{ id: p.query, kind: "mcp", version: "1.0.0", description: "Protocol fixture", source: "fixture:catalog", runtime: "remote", permissions: [] }]
});
conn.onRequest("mete/registry.prepare", (p) => p.name === "odd" ? { server: {}, notes: [], source: "" } : {
	server: { id: p.name, transport: "sse", url: "https://example.test/mcp" },
	notes: ["Review required settings"], source: "fixture:catalog"
});
conn.onRequest("mete/run.start", (p) => {
	if (!p.templateId && p.goal === "unsure" && p.templateId !== null) throw new ResponseError(-32000, "the router is unsure", { code: "choose_template", suggestions: ["research", "web-dev"] });
	return { runId: run.id };
});
conn.onRequest("mete/run.approve", (p) => {
	if (p.runId === "late") throw new ResponseError(-32000, "the run is completed, not paused for approval", { code: "invalid_state" });
	return null;
});
conn.onRequest("mete/run.resume", (p) => (p.runId === "late" ? "odd" : null));
conn.onRequest("mete/run.allow", (p) => {
	if (p.runId === "late") return "odd";
	if (p.scope === "always" && p.runId === "masked")
		throw new ResponseError(-32000, "Always allow takes a command whose text was not masked; allow it once or for the run", { code: "bad_input" });
	return null;
});
conn.onRequest("mete/run.model", (p) => {
	if (p.runId === "late") return "odd";
	if (p.runId === "refuse")
		throw new ResponseError(-32000, "run not found", { code: "not_found" });
	return null;
});
conn.onRequest("mete/events", (p) => {
	if (mode === "badevents") return { events: [], unreadable: -1 };
	if (p.runId !== run.id) throw new ResponseError(-32000, "run not found", { code: "not_found" });
	const base = { schema: 1, workspaceId: run.workspaceId, runId: run.id, source: "core-engine", ts: run.createdAt };
	return { events: [{ ...base, id: "7c1d3e52-9b7e-4a52-8d5f-0a1b2c3d4e61", type: "run.started", payload: {} }], unreadable: 1 };
});
conn.onRequest("mete/audit", (p) => {
	const entry = { seq: 1, ts: run.createdAt, runId: run.id, agentId: null, action: "fs.write", capability: "fs.edit@1", adapterId: "tools-fs", argsSha256: "a".repeat(64), verdict: "allow", rule: "autonomy:2:inside", tainted: false };
	return { entries: p.verdict === "deny" ? [] : [entry] };
});
conn.onRequest("mete/templates", () => ({ templates: [{ id: "game-studio", name: "Game studio" }] }));
conn.onRequest("mete/template.read", (p) => {
	if (p.id === "nope") throw new ResponseError(-32000, "no template nope", { code: "not_found" });
	return p.id === "bad" ? { id: "bad", source: "global", yaml: "" } : { id: p.id, source: "builtIn", yaml: "kind: TeamTemplate" };
});
conn.onRequest("mete/chain", (p) => (p.tier === "vision" ? { models: [{ providerId: "groq" }] } : { models: [{ providerId: "groq", modelId: "m" }] }));
conn.onRequest("mete/models", (p) => ({ models: p.models.filter((m) => m.modelId !== "gone").map((m) => (m.modelId === "odd" ? { id: "odd" } : { id: m.modelId, providerId: m.providerId, family: "", contextWindow: 128000, toolCalling: true, vision: false, free: true, deprecated: false })) }));
conn.onRequest("mete/provider.models", (p) => {
	if (p.providerId === "custom:gone") throw new ResponseError(-32000, "no custom:gone", { code: "not_found" });
	return { failed: { code: "unauthorized", message: "bad key", status: 401 } };
});
conn.onRequest("mete/provider.test", (p) => ({ results: p.models.map((modelId) => ({ modelId, ok: true, ms: 5 })) }));
conn.onRequest("mete/mcp.test", (p) => {
	if (p.id === "later") throw new ResponseError(-32000, "no MCP server later in mcp.yaml", { code: "not_found" });
	return p.id === "odd" ? { id: "odd", ok: true } : { id: p.id, ok: true, tools: ["echo"], ms: 7 };
});
conn.onRequest("mete/stop.all", () => ({ cancelled: [run.id] }));
conn.onRequest("mete/estimate", (p) => (p.templateId === "bad" ? { providers: "x" } : { providers: [{ providerId: "groq", requests: 15 }], unassigned: 3 }));
conn.onRequest("mete/quota", () =>
	mode === "badquota"
		? { providers: [{ id: "groq", state: "exhausted" }], units: [] }
		: { providers: [{ id: "groq", state: "exhausted", resetsAt: "2026-10-24T00:00:00.000Z" }, { id: "nvidia", state: "no_key" }], units: [{ providerId: "groq", unit: "requests_per_minute", scope: null, used: 3, limit: 30, history: [{ at: "2026-10-23T09:00:00.000Z", amount: 3 }] }] },
);
conn.onClose(() => process.exit(0));
conn.listen();
`;

/** Writes the script and returns a spawn that counts its starts; `mode` may change between calls. */
export const fakeDaemon = async () => {
	const root = await mkdtemp(join(tmpdir(), "mete-fake-daemon-"));
	const script = join(root, "daemon.cjs");
	await writeFile(script, SCRIPT);
	const state = { mode: "ok", starts: [] as string[] };
	return {
		state,
		spawn: (dir: string) => {
			state.starts.push(dir);
			return spawn(process.execPath, [script, dir, state.mode]);
		},
		close: () => rm(root, { recursive: true, force: true }),
	};
};
