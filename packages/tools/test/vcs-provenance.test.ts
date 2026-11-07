import { ok, type VcsGitAdapter } from "@mete/contracts";
import type { Disposable } from "@mete/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createVcsGitModule } from "../src/module.js";
import { toolContext } from "./helpers/context.js";
import { initRepo, isolateGit } from "./helpers/repo.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

beforeAll(isolateGit);
let ws: Awaited<ReturnType<typeof tempWorkspace>> | undefined;
afterEach(async () => {
	await ws?.close();
	ws = undefined;
});

describe("native checkpoint adapter provenance", () => {
	it("attests exactly the registered implementation after registration", async () => {
		ws = await tempWorkspace();
		await initRepo(ws.workspaceDir);
		const { ctx, registry } = toolContext("allow");
		const received: VcsGitAdapter[] = [];
		const module = createVcsGitModule({
			...ws,
			onCheckpointAdapter: (adapter) => {
				const registered = registry.resolve<VcsGitAdapter>("vcs.git@2");
				expect(registered.ok && registered.value[0].impl).toBe(adapter);
				received.push(adapter);
			},
		});
		expect(await module.activate(ctx)).toEqual(ok(undefined));
		const registered = registry.resolve<VcsGitAdapter>("vcs.git@2");
		expect(received).toHaveLength(1);
		expect(registered.ok && registered.value[0].impl).toBe(received[0]);
	});

	it("does not attest when native activation fails", async () => {
		ws = await tempWorkspace();
		const { ctx, registry } = toolContext("allow");
		const received: VcsGitAdapter[] = [];
		const result = await createVcsGitModule({
			...ws,
			onCheckpointAdapter: (adapter) => {
				received.push(adapter);
			},
		}).activate(ctx);
		expect(result).toMatchObject({
			ok: false,
			error: { code: "activation_failed" },
		});
		expect(received).toEqual([]);
		expect(registry.resolve("vcs.git@2").ok).toBe(false);
	});

	it("does not confer provenance on a wrapper or a replacement with the same registration id", async () => {
		ws = await tempWorkspace();
		await initRepo(ws.workspaceDir);
		const { ctx, registry } = toolContext("allow");
		const trusted = new WeakSet<VcsGitAdapter>();
		const registrations: Disposable[] = [];
		await createVcsGitModule({
			...ws,
			onCheckpointAdapter: (adapter) => {
				trusted.add(adapter);
			},
		}).activate({
			...ctx,
			disposables: {
				add: (disposable) => {
					registrations.push(disposable);
				},
				dispose: () => {
					registrations[0]?.dispose();
				},
			},
		});
		expect(registrations).toHaveLength(1);
		const registration = registrations[0];
		const registered = registry.resolve<VcsGitAdapter>("vcs.git@2");
		if (!registered.ok || !registration)
			throw new Error("native adapter missing");
		const native = registered.value[0];
		const wrapped: VcsGitAdapter = {
			run: (input, context) => native.impl.run(input, context),
		};
		const replacement: VcsGitAdapter = { run: native.impl.run };
		expect(trusted.has(native.impl)).toBe(true);
		expect(trusted.has(wrapped)).toBe(false);
		expect(trusted.has(replacement)).toBe(false);
		registration.dispose();
		registry.provide("vcs.git@2", { ...native, impl: replacement });
		const current = registry.resolve<VcsGitAdapter>("vcs.git@2");
		expect(current.ok && current.value[0].impl).toBe(replacement);
		expect(current.ok && trusted.has(current.value[0].impl)).toBe(false);
	});
});
