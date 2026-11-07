import {
	err,
	type McpConnectionRequest,
	type McpCredentialWrite,
	type McpSignInStarted,
	ok,
	type Result,
} from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { McpConnectionSession } from "../src/application/mcp-connection-session.js";
import type { DaemonFailure } from "../src/domain/status-service.js";

const server = {
	id: "docs",
	transport: "sse" as const,
	url: "https://example.test/mcp",
	auth: "oauth" as const,
	permissions: [],
};
const attemptId = "11111111-1111-4111-8111-111111111111";
const state = (
	phase: McpSignInStarted["state"]["phase"],
): McpSignInStarted => ({
	state: {
		id: "docs",
		identity: "a".repeat(64),
		phase,
		fields: [],
		...(phase === "pending" ? { attemptId } : {}),
	},
	...(phase === "pending"
		? { authorizationUrl: "https://login.example.test/authorize" }
		: {}),
});
const setup = () => {
	let tick: (() => void) | undefined;
	const deps = {
		connection: vi.fn(
			async (
				_dir: string,
				input: McpConnectionRequest,
			): Promise<Result<McpSignInStarted, DaemonFailure>> =>
				ok(
					state(
						input.op === "start"
							? "pending"
							: input.op === "cancel"
								? "cancelled"
								: "needs_sign_in",
					),
				),
		),
		credentials: vi.fn(
			async (
				_dir: string,
				_input: McpCredentialWrite,
			): Promise<Result<null, DaemonFailure>> => ok(null),
		),
		restart: vi.fn(
			async (_dir: string): Promise<Result<null, DaemonFailure>> => ok(null),
		),
		open: vi.fn(),
		changed: vi.fn(),
		schedule: (callback: () => void) => {
			tick = callback;
			return () => {
				tick = undefined;
			};
		},
	};
	const session = new McpConnectionSession(deps);
	const target = { dir: "/w", scope: "workspace", expected: server };
	return { session, deps, target, poll: () => tick?.() };
};
const deferred = () => {
	let resolve = (_result: Result<McpSignInStarted, DaemonFailure>) => {};
	const promise = new Promise<Result<McpSignInStarted, DaemonFailure>>(
		(done) => {
			resolve = done;
		},
	);
	return {
		promise,
		resolve: (result: Result<McpSignInStarted, DaemonFailure>) =>
			resolve(result),
	};
};

describe("captured MCP connection management", () => {
	it("reads only local status and opens a browser only for explicit sign in", async () => {
		const { session, deps, target } = setup();
		await session.show(target);
		expect(deps.open).not.toHaveBeenCalled();
		expect(deps.restart).not.toHaveBeenCalled();
		await session.run("start");
		expect(deps.open).toHaveBeenCalledExactlyOnceWith(
			"https://login.example.test/authorize",
		);
		expect(session.state.connection?.phase).toBe("pending");
		await session.run("cancel");
		expect(deps.connection).toHaveBeenLastCalledWith("/w", {
			op: "cancel",
			expected: server,
			attemptId,
		});
		expect(deps.restart).toHaveBeenCalledExactlyOnceWith("/w");
	});

	it("cancels a late sign-in for its original workspace without opening its URL", async () => {
		const { session, deps, target } = setup();
		await session.show(target);
		const pending = deferred();
		deps.connection.mockImplementationOnce(() => pending.promise);
		const start = session.run("start");
		await session.show({ ...target, dir: "/other" });
		pending.resolve(ok(state("pending")));
		await start;
		expect(deps.open).not.toHaveBeenCalled();
		expect(deps.connection).toHaveBeenCalledWith("/w", {
			op: "cancel",
			expected: server,
			attemptId,
		});
		expect(deps.restart).toHaveBeenCalledWith("/w");
		expect(session.state.connection?.phase).toBe("needs_sign_in");
	});

	it("polls pending status and reopens the engine after a final result", async () => {
		const { session, deps, target, poll } = setup();
		await session.show(target);
		await session.run("start");
		deps.connection.mockResolvedValueOnce(ok(state("configured")));
		poll();
		await vi.waitFor(() => expect(session.state.busy).toBe(false));
		expect(session.canConnect).toBe(true);
		expect(session.state.connection?.phase).toBe("configured");
		expect(deps.restart).toHaveBeenCalledExactlyOnceWith("/w");
		expect(deps.open).toHaveBeenCalledTimes(1);
	});

	it("clears an optional empty value and refuses malformed or oversized values", async () => {
		const { session, deps, target } = setup();
		await session.show(target);
		session.addField("X-Key", true);
		session.type("header:X-Key", "temporary");
		session.type("header:X-Key", "");
		expect(session.state.values).toEqual({});
		session.type("header:X-Key", "bad\nvalue");
		await session.save();
		expect(deps.credentials).not.toHaveBeenCalled();
		expect(session.state.error).toBe("invalid");
		session.type("header:X-Key", "x".repeat(4097));
		await session.save();
		expect(deps.credentials).not.toHaveBeenCalled();
	});
	it("gates connected optional-only edits until saved or explicitly reset", async () => {
		const { session, deps, target } = setup();
		const field = {
			kind: "header" as const,
			name: "X-Key",
			required: false,
			secret: true,
		};
		const configured = {
			state: {
				...state("connected").state,
				fields: [{ ...field, configured: true }],
			},
		};
		deps.connection.mockResolvedValue(ok(configured));
		await session.show({
			...target,
			expected: { ...server, auth: "none", credentialFields: [field] },
		});
		expect(session.state.values).toEqual({});
		expect(session.canConnect).toBe(true);
		session.type("header:X-Key", "NEW_SECRET");
		expect(session.state.dirty).toBe(true);
		expect(session.canConnect).toBe(false);
		deps.credentials.mockResolvedValueOnce(
			err({ code: "cli", detail: "untrusted" }),
		);
		await session.save();
		expect(session.state.values).toEqual({ "header:X-Key": "NEW_SECRET" });
		expect(session.state.dirty).toBe(true);
		await session.run("status");
		expect(session.canConnect).toBe(false);
		await session.save();
		expect(session.state.dirty).toBe(false);
		expect(session.state.values).toEqual({});
		expect(session.canConnect).toBe(true);
		session.addField("X-Optional", false);
		expect(session.canConnect).toBe(false);
		await session.clear();
		expect(session.state.dirty).toBe(false);
	});

	it("keeps Connect blocked after restart failure and permits local-status retry", async () => {
		const { session, deps, target } = setup();
		await session.show(target);
		await session.run("start");
		deps.restart.mockResolvedValueOnce(err({ code: "refused", detail: "" }));
		deps.connection.mockResolvedValueOnce(ok(state("configured")));
		await session.run("status");
		expect(session.state.error).toBe("restart");
		expect(session.canConnect).toBe(false);
		deps.connection.mockResolvedValueOnce(ok(state("configured")));
		await session.run("status");
		expect(deps.restart).toHaveBeenCalledTimes(2);
		expect(session.canConnect).toBe(true);
	});

	it("uses exact persisted requirements, restores configured booleans, and forgets locally", async () => {
		const { session, deps } = setup();
		const field = {
			kind: "env" as const,
			name: "METE_TEST_KEY",
			required: true,
			secret: true,
		};
		const expected = {
			id: "docs",
			transport: "stdio" as const,
			runtime: "node" as const,
			command: "fixture",
			args: [],
			permissions: [],
			credentialFields: [field],
		};
		const target = { dir: "/w", scope: "workspace", expected };
		let configured = false;
		deps.connection.mockImplementation(async (_dir, input) => {
			if (input.op === "forget") configured = false;
			return ok({
				state: {
					id: "docs",
					identity: "a".repeat(64),
					phase: configured ? "configured" : "needs_credentials",
					fields: [{ ...field, configured }],
				},
			});
		});
		deps.credentials.mockImplementation(async (_dir, input) => {
			expect(input.fields).toEqual([field]);
			expect(Object.keys(input.values)).toEqual(["env:METE_TEST_KEY"]);
			configured = true;
			return ok(null);
		});
		await session.show(target);
		expect(session.canConnect).toBe(false);
		session.type("env:METE_TEST_KEY", "SECRET_SENTINEL");
		await session.save();
		expect(session.canConnect).toBe(true);
		expect(session.state.values).toEqual({});
		await session.clear();
		await session.show(target);
		expect(session.canConnect).toBe(true);
		expect(JSON.stringify(session.state)).not.toContain("SECRET_SENTINEL");
		await session.run("forget");
		expect(session.canConnect).toBe(false);
		expect(session.state.connection?.phase).toBe("needs_credentials");
		expect(session.state.fields).toEqual([field]);
		expect(deps.restart).toHaveBeenCalledExactlyOnceWith("/w");
	});

	it("clears typed secrets on retarget and ignores late credential writes", async () => {
		const { session, deps, target } = setup();
		const field = {
			kind: "header" as const,
			name: "X-Key",
			required: true,
			secret: true,
		};
		await session.show({
			...target,
			expected: { ...server, auth: "none", credentialFields: [field] },
		});
		expect(session.canConnect).toBe(false);
		session.type("header:X-Key", "SECRET_SENTINEL");
		let finish = (_value: Result<null, DaemonFailure>) => {};
		const saved = new Promise<Result<null, DaemonFailure>>((resolve) => {
			finish = resolve;
		});
		deps.credentials.mockImplementationOnce(() => saved);
		const write = session.save();
		await session.show({ ...target, scope: "global" });
		expect(session.state.values).toEqual({});
		expect(deps.credentials.mock.calls[0]?.[1]).toMatchObject({
			values: { "header:X-Key": "SECRET_SENTINEL" },
		});
		finish(ok(null));
		await write;
		expect(session.state.connection?.phase).toBe("needs_sign_in");
	});

	it("requires every value, clears them on success, and never echoes server failures", async () => {
		const { session, deps, target } = setup();
		const field = {
			kind: "header" as const,
			name: "X-Key",
			required: true,
			secret: true,
		};
		await session.show({
			...target,
			expected: { ...server, auth: "none", credentialFields: [field] },
		});
		await session.save();
		expect(deps.credentials).not.toHaveBeenCalled();
		session.type("header:X-Key", "SECRET_SENTINEL");
		await session.save();
		expect(session.state.values).toEqual({});
		deps.connection.mockResolvedValueOnce(
			err({ code: "refused", detail: "SECRET_SENTINEL" }),
		);
		await session.run("forget");
		expect(JSON.stringify(session.state)).not.toContain("SECRET_SENTINEL");
		expect(deps.restart).toHaveBeenCalledWith("/w");
	});

	it("retires a captured attempt on disposal and rejects malformed sign-in responses", async () => {
		const { session, deps, target } = setup();
		await session.show(target);
		await session.run("start");
		await session.clear();
		expect(deps.connection).toHaveBeenCalledWith("/w", {
			op: "cancel",
			expected: server,
			attemptId,
		});
		expect(session.state.values).toEqual({});
		await session.show(target);
		deps.connection.mockResolvedValueOnce(
			ok({ ...state("pending"), authorizationUrl: "http://unsafe.test" }),
		);
		await session.run("start");
		expect(deps.open).toHaveBeenCalledTimes(1);
		expect(deps.restart).toHaveBeenCalledTimes(2);
	});
});
