import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import {
	ok,
	type SkillMutationResult,
	type SkillPreview,
	type SkillTrustAdapter,
	type SkillTrustEntry,
} from "@mete/contracts";
import { createCapabilityRegistry, createEventBus } from "@mete/kernel";
import { vi } from "vitest";
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { daemonCommand } from "../src/application/daemon.js";
import { serveSkills } from "../src/application/daemon-skills.js";
import type { App } from "../src/infrastructure/app.js";
import { recordingIo } from "./helpers.js";

export const sourceId = "a".repeat(64);
export const previewId = randomUUID();
export const entry: SkillTrustEntry = {
	source: { sourceId, scope: "workspace", path: "public/SKILL.md" },
	metadata: { name: "public", description: "Public instructions" },
	status: "approved",
	revision: 1,
	approvedSha256: "b".repeat(64),
	currentSha256: "b".repeat(64),
	diagnostics: [],
};
export const preview: SkillPreview = {
	previewId,
	inspection: {
		source: entry.source,
		metadata: { name: "public", description: "Public instructions" },
		text: "---\nname: public\ndescription: Public instructions\n---\nReview.\n",
		sha256: "b".repeat(64),
	},
	expiresAt: "2026-11-08T12:05:00.000Z",
	revision: 0,
};
export const mutation: SkillMutationResult = {
	admitted: true,
	result: ok(entry),
};

export const skillProtocol = (
	daemon = false,
	skillSourceAdapters?: App["skillSourceAdapters"],
) => {
	const registry = createCapabilityRegistry(() => []);
	const status = vi.fn<SkillTrustAdapter["status"]>(async () =>
		ok({ entries: [entry], complete: true, diagnostics: [] }),
	);
	const prepare = vi.fn<SkillTrustAdapter["prepare"]>(async () => ok(preview));
	const approve = vi.fn<SkillTrustAdapter["approve"]>(async () => mutation);
	const disable = vi.fn<SkillTrustAdapter["disable"]>(async () => mutation);
	const impl: SkillTrustAdapter = { status, prepare, approve, disable };
	const natives = new WeakSet<SkillTrustAdapter>([impl]);
	const provide = (adapter = impl) =>
		registry.provide("skill.trust@1", {
			id: "skills-trust",
			trust: "core",
			features: [],
			impl: adapter,
		});
	const registration = provide();
	const input = new PassThrough();
	const output = new PassThrough();
	const stop = vi.fn(async () => {});
	const app = {
		registry,
		...(skillSourceAdapters ? { skillSourceAdapters } : {}),
		skillTrustAdapters: {
			has: (adapter: SkillTrustAdapter) => natives.has(adapter),
		},
		events: createEventBus((error) => {
			throw error;
		}),
		modules: [],
		inactive: [],
		stop,
	} as unknown as App;
	const server = createMessageConnection(
		new StreamMessageReader(input),
		new StreamMessageWriter(output),
	);
	const dispose = daemon ? () => {} : serveSkills(server, app);
	const serving = daemon
		? daemonCommand(app, recordingIo().io, ".", { input, output })
		: undefined;
	if (!daemon) server.listen();
	const client = createMessageConnection(
		new StreamMessageReader(output),
		new StreamMessageWriter(input),
	);
	client.listen();
	let closed = false;
	return {
		client,
		registry,
		status,
		prepare,
		approve,
		disable,
		impl,
		natives,
		registration,
		provide,
		stop,
		async close() {
			if (closed) return;
			closed = true;
			dispose();
			if (serving) {
				input.end();
				await serving;
			}
			client.dispose();
			server.dispose();
			input.destroy();
			output.destroy();
		},
	};
};
