import { tmpdir } from "node:os";
import { McpServerSchema, ok, type SecretStore } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { createCalls } from "../src/application/calls.js";
import { createMcpConnection } from "../src/application/mcp-connection.js";
import { createSessions } from "../src/application/sessions.js";
import { openTransport } from "../src/infrastructure/transport.js";
import { oauthManagementServer } from "./helpers/oauth-management.js";

const setup = () => {
	const remote = oauthManagementServer();
	const saved = new Map<string, string>();
	const secrets: SecretStore = {
		get: async (name) => ok(saved.get(name)),
		set: async (name, value) => ok(void saved.set(name, value)),
		delete: async (name) => ok(saved.delete(name)),
	};
	const server = McpServerSchema.parse({
		id: "fixture",
		transport: "streamable-http",
		url: `${remote.root}/mcp`,
		auth: "oauth",
	});
	const deps = {
		moduleId: "mcp",
		version: "0",
		workspaceDir: tmpdir(),
		servers: [server],
		calls: createCalls(),
		open: openTransport,
		secrets,
		fetch: remote.fetch,
		logger: { debug() {}, info() {}, warn() {}, error() {} },
	};
	const connection = createMcpConnection({
		sessionDeps: deps,
		retire: async () => {},
	});
	return { connection, server, deps, remote, saved };
};
const signal = new AbortController().signal;
const callbackAddress = (authorizationUrl: string) => {
	const auth = new URL(authorizationUrl);
	const callback = new URL(auth.searchParams.get("redirect_uri") ?? "");
	callback.searchParams.set("state", auth.searchParams.get("state") ?? "");
	callback.searchParams.set("code", "offline-code");
	return callback;
};

describe("desktop OAuth lifecycle over SDK and real callback", () => {
	it("keeps cancellation pending until an in-flight keychain publication is rolled back", async () => {
		const { connection, server, deps, saved } = setup();
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const set = deps.secrets.set;
		deps.secrets.set = async (name, value) => {
			if (name.endsWith("/manifest")) {
				entered.resolve();
				await release.promise;
			}
			return set(name, value);
		};
		try {
			const started = await connection.adapter.start(server, signal);
			if (
				!started.ok ||
				!started.value.authorizationUrl ||
				!started.value.state.attemptId
			)
				throw new Error("Missing pending flow");
			await fetch(callbackAddress(started.value.authorizationUrl));
			await entered.promise;
			let ended = false;
			const cancelled = connection.adapter
				.cancel(server, started.value.state.attemptId)
				.then((result) => {
					ended = true;
					return result;
				});
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(ended).toBe(false);
			expect(await connection.adapter.status(server, signal)).toMatchObject({
				ok: true,
				value: { phase: "pending" },
			});
			release.resolve();
			expect(await cancelled).toMatchObject({
				ok: true,
				value: { phase: "cancelled" },
			});
			expect(saved.size).toBe(0);
		} finally {
			release.resolve();
			await connection.close();
		}
	});
	it("finishes an explicit flow, reuses tokens after restart and forgets locally", async () => {
		const { connection, server, deps, remote, saved } = setup();
		try {
			const started = await connection.adapter.start(server, signal);
			expect(started.ok).toBe(true);
			if (!started.ok || !started.value.authorizationUrl)
				throw new Error("Missing authorization URL");
			const callback = callbackAddress(started.value.authorizationUrl);
			expect(callback.hostname).toBe("127.0.0.1");
			expect((await fetch(callback)).status).toBe(200);
			await vi.waitFor(async () =>
				expect(await connection.adapter.status(server, signal)).toMatchObject({
					ok: true,
					value: { phase: "connected" },
				}),
			);
			expect(remote.seen).toEqual({ registration: 1, exchange: 1 });
			expect(
				JSON.stringify(await connection.adapter.status(server, signal)),
			).not.toContain(remote.token);
			const later = createSessions(deps);
			try {
				expect((await later.get(server.id, signal)).ok).toBe(true);
			} finally {
				await later.close();
			}
			expect(remote.seen.registration).toBe(1);
			expect((await connection.adapter.forget(server, signal)).ok).toBe(true);
			expect(saved.size).toBe(0);
		} finally {
			await connection.close();
		}
	});

	it("cancels the captured attempt, refuses replay and permits an explicit retry", async () => {
		const { connection, server, remote, saved } = setup();
		try {
			const first = await connection.adapter.start(server, signal);
			if (
				!first.ok ||
				!first.value.authorizationUrl ||
				!first.value.state.attemptId
			)
				throw new Error("Missing pending flow");
			const callback = callbackAddress(first.value.authorizationUrl);
			expect((await connection.adapter.start(server, signal)).ok).toBe(false);
			expect(
				await connection.adapter.cancel(server, first.value.state.attemptId),
			).toMatchObject({ ok: true, value: { phase: "cancelled" } });
			await expect(fetch(callback)).rejects.toThrow();
			expect(saved.size).toBe(0);
			expect(remote.seen.exchange).toBe(0);
			const retry = await connection.adapter.start(server, signal);
			expect(retry.ok && retry.value.state.failure).toBeUndefined();
			expect(retry.ok && retry.value.state.attemptId).not.toBe(
				first.value.state.attemptId,
			);
		} finally {
			await connection.close();
		}
	});

	it("never dynamically registers on a noninteractive tool connection", async () => {
		const { connection, server, deps, remote } = setup();
		const sessions = createSessions(deps);
		try {
			expect((await sessions.get(server.id, signal)).ok).toBe(false);
			expect(remote.seen.registration).toBe(0);
			expect(remote.seen.exchange).toBe(0);
		} finally {
			await sessions.close();
			await connection.close();
		}
	});
});
