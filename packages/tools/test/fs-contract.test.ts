import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	ok,
	type PolicyCheckAdapter,
	type PolicyVerdict,
	type ToolAdapter,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { type FsTools, fsToolsContract } from "@mete/testing";
import { createToolsFsModule } from "../src/module.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

/** A module context with only a registry, and a policy.check@1 that always answers `verdict`. */
export const toolContext = (verdict: PolicyVerdict["verdict"]) => {
	const registry = createCapabilityRegistry(() => []);
	const policy: PolicyCheckAdapter = {
		check: () => ok({ verdict, rule: `kit:${verdict}` }),
	};
	registry.provide("policy.check@1", {
		id: "security",
		trust: "core",
		features: [],
		impl: policy,
	});
	const items: { dispose(): void }[] = [];
	const log = () => {};
	const ctx = {
		capabilities: registry,
		events: createEventBus((e) => {
			throw e;
		}),
		config: createConfigReader({
			global: { file: "settings.yaml", sections: {} },
			workspace: {},
		}),
		logger: { error: log, warn: log, info: log, debug: log },
		disposables: {
			add: (d: { dispose(): void }) => void items.push(d),
			dispose: () => {},
		},
	} satisfies ModuleContext;
	return { ctx, registry };
};

fsToolsContract("tools-fs", async (verdict) => {
	const ws = await tempWorkspace();
	const { ctx, registry } = toolContext(verdict);
	const r = await createToolsFsModule(ws).activate(ctx);
	if (!r.ok) throw new Error(r.error.message);
	const get = <I, O>(ref: `fs.${string}@1`) => {
		const c = registry.resolve<ToolAdapter<I, O>>(ref);
		if (!c.ok) throw new Error(`${ref} missing`);
		return c.value[0].impl;
	};
	const tools: FsTools = {
		read: get("fs.read@1"),
		write: get("fs.write@1"),
		edit: get("fs.edit@1"),
		list: get("fs.list@1"),
		glob: get("fs.glob@1"),
		grep: get("fs.grep@1"),
	};
	await mkdir(join(ws.globalDir, "worktrees"), { recursive: true });
	return { tools, close: ws.close };
});
