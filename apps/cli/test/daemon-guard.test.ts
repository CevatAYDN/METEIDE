import type { SecretsMaskAdapter } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	ErrorCodes,
	type MessageConnection,
	ResponseError,
} from "vscode-jsonrpc/node";
import { guardedConnection } from "../src/application/daemon-guard.js";

// A handler that throws must never echo its message to the client: it may carry a key (ADR-166).

const KEY = "sk-abcdef0123456789abcdef";
type Handler = (...args: unknown[]) => unknown;

const fakeConn = () => {
	const handlers = new Map<string, Handler>();
	const conn = {
		onRequest: (method: unknown, handler: unknown) => {
			handlers.set(String(method), handler as Handler);
			return { dispose: () => {} };
		},
	} as unknown as MessageConnection;
	return { conn, handlers };
};

const masker: SecretsMaskAdapter = {
	mask: async (text) => ({ text: text.replace(KEY, "[SECRET]"), masked: 1 }),
};

const failing = async (p: Promise<unknown>) => {
	try {
		await p;
	} catch (e) {
		if (e instanceof ResponseError) return e;
		throw e;
	}
	throw new Error("the request should have failed");
};

const served = (mask: SecretsMaskAdapter | undefined) => {
	const { conn, handlers } = fakeConn();
	const logged: string[] = [];
	const guarded = guardedConnection(
		conn,
		() => mask,
		(line) => void logged.push(line),
	);
	guarded.onRequest("mete/boom", () => {
		throw new Error(`key ${KEY}`);
	});
	guarded.onRequest("mete/fine", async (n: number) => n + 1);
	guarded.onRequest("mete/refused", () => {
		throw new ResponseError(ErrorCodes.InvalidParams, "bad params");
	});
	const call = (method: string, ...args: unknown[]) => {
		const h = handlers.get(method);
		if (!h) throw new Error(`no handler for ${method}`);
		return Promise.resolve().then(() => h(...args));
	};
	return { call, logged };
};

describe("daemon guard", () => {
	it("masks a thrown message through secrets.mask@1 and logs it", async () => {
		const { call, logged } = served(masker);
		const e = await failing(call("mete/boom"));
		expect(e.code).toBe(ErrorCodes.InternalError);
		expect(e.message).not.toContain(KEY);
		expect(e.message).toContain("[SECRET]");
		expect(logged.join("\n")).toContain("mete/boom");
		expect(logged.join("\n")).not.toContain(KEY);
	});

	it("answers a generic internal error when no masker is active", async () => {
		const { call, logged } = served(undefined);
		const e = await failing(call("mete/boom"));
		expect(e.code).toBe(ErrorCodes.InternalError);
		expect(e.message).toBe("internal error");
		expect(e.message).not.toContain(KEY);
		expect(logged.join("\n")).not.toContain(KEY);
	});

	it("passes answers and ResponseErrors through unchanged", async () => {
		const { call } = served(masker);
		expect(await call("mete/fine", 1)).toBe(2);
		const e = await failing(call("mete/refused"));
		expect(e.code).toBe(ErrorCodes.InvalidParams);
		expect(e.message).toBe("bad params");
	});
});
