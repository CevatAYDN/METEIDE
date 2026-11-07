import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, type McpServer, ok, type SecretStore } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CREDENTIAL_PIECE_CHARS } from "../src/defaults.js";
import { createCredentialRecords } from "../src/infrastructure/credential-records.js";
import { oauthSignIn, REDIRECT_URL } from "../src/infrastructure/oauth.js";
import {
	forgetOAuth,
	oauthConfigured,
	oauthTarget,
	readOAuthRecord,
} from "../src/infrastructure/oauth-record.js";

const server: McpServer = {
	id: "remote",
	transport: "streamable-http",
	url: "https://mcp.example/mcp",
	auth: "oauth",
	permissions: [],
};
const issuer = "https://issuer.example";
const signal = new AbortController().signal;
let workspaceDir = "";
beforeEach(async () => {
	workspaceDir = await mkdtemp(join(tmpdir(), "mete-oauth-"));
});
afterEach(() => rm(workspaceDir, { recursive: true, force: true }));
const setup = () => {
	const data = new Map<string, string>();
	const secrets = {
		get: vi.fn<SecretStore["get"]>(async (name) => ok(data.get(name))),
		set: vi.fn<SecretStore["set"]>(async (name, value) => {
			data.set(name, value);
			return ok(undefined);
		}),
		delete: vi.fn<SecretStore["delete"]>(async (name) => ok(data.delete(name))),
	};
	const options = { secrets, workspaceDir, server, signal, interactive: true };
	return { data, secrets, options };
};
const stage = async (
	options: Parameters<typeof oauthSignIn>[0],
	value = "sentinel-token",
) => {
	const result = await oauthSignIn(options);
	if (!result.ok) throw new Error("fixture flow unavailable");
	const flow = result.value;
	await flow.provider.saveClientInformation?.(
		{ client_id: "client", issuer },
		{ issuer },
	);
	await flow.provider.saveTokens(
		{ access_token: value, token_type: "Bearer", issuer },
		{ issuer },
	);
	return flow;
};

describe("target-bound OAuth records", () => {
	it("allows an explicit terminal host to reauthorize stale tokens without deleting the usable record first", async () => {
		const { options } = setup();
		expect((await (await stage(options, "old-token")).commit()).ok).toBe(true);
		const again = await oauthSignIn(options);
		if (!again.ok) throw new Error("Missing replacement flow");
		await again.value.provider.invalidateCredentials?.("tokens");
		await again.value.provider.saveCodeVerifier("new-verifier");
		await again.value.provider.redirectToAuthorization(
			new URL("https://issuer.example/authorize"),
		);
		expect(again.value.url()?.hostname).toBe("issuer.example");
		const untouched = await oauthSignIn({ ...options, interactive: false });
		if (!untouched.ok) throw new Error("Old record was lost");
		expect((await untouched.value.provider.tokens())?.access_token).toBe(
			"old-token",
		);
	});
	it("does not require OAuth for a local or header-only server", async () => {
		const { secrets } = setup();
		const local: McpServer = {
			id: "local",
			transport: "stdio",
			runtime: "node",
			command: "node",
			args: [],
			permissions: [],
		};
		for (const target of [local, { ...server, auth: "none" as const }]) {
			expect(await oauthConfigured(secrets, workspaceDir, target)).toEqual(
				ok(false),
			);
			expect(await forgetOAuth(secrets, workspaceDir, target)).toEqual(
				ok(undefined),
			);
		}
		expect(secrets.get).not.toHaveBeenCalled();
	});
	it("stages SDK issuer stamps until explicit commit and exposes no secret status", async () => {
		const { options, secrets, data } = setup();
		const values: string[] = [];
		const flow = await stage({
			...options,
			onSecrets: (next) => values.push(...next),
		});
		expect(data.size).toBe(0);
		expect(await oauthConfigured(secrets, workspaceDir, server)).toEqual(
			ok(false),
		);
		expect(await flow.commit()).toEqual(ok(undefined));
		const target = await oauthTarget(workspaceDir, server);
		if (!target.ok) throw new Error("fixture target unavailable");
		const stored = await readOAuthRecord(
			secrets,
			target.value.name,
			target.value.resource,
		);
		expect(stored.ok && stored.value).toMatchObject({
			issuer,
			clientId: "client",
			redirectUrl: REDIRECT_URL,
			client: { issuer },
			tokens: { issuer },
		});
		expect(values).toContain("sentinel-token");
		expect(await oauthConfigured(secrets, workspaceDir, server)).toEqual(
			ok(true),
		);
		expect(await forgetOAuth(secrets, workspaceDir, server)).toEqual(
			ok(undefined),
		);
		expect(data.size).toBe(0);
	});

	it("blocks missing noninteractive credentials without enabling registration", async () => {
		const { options, secrets } = setup();
		const result = await oauthSignIn({ ...options, interactive: false });
		expect(result.ok).toBe(false);
		expect(JSON.stringify(result)).toMatch(/sign in.*terminal/);
		expect(secrets.set).not.toHaveBeenCalled();
	});

	it("does not migrate origin records or share workspace/path credentials", async () => {
		const { options, secrets, data } = setup();
		data.set("mcp/https://mcp.example/tokens", "1");
		const flow = await stage(options);
		await flow.commit();
		const nested = join(workspaceDir, "other");
		const { mkdir } = await import("node:fs/promises");
		await mkdir(nested);
		expect(
			(
				await oauthSignIn({
					...options,
					workspaceDir: nested,
					interactive: false,
				})
			).ok,
		).toBe(false);
		expect(
			(
				await oauthSignIn({
					...options,
					server: { ...server, url: "https://mcp.example/other" },
					interactive: false,
				})
			).ok,
		).toBe(false);
		expect(await oauthConfigured(secrets, nested, server)).toEqual(ok(false));
		expect(data.has("mcp/https://mcp.example/tokens")).toBe(true);
	});

	it.each(["cancel", "partial", "issuer"])(
		"preserves usable credentials on %s failure",
		async (mode) => {
			const { options, secrets, data } = setup();
			await (await stage(options, "old")).commit();
			const before = [...data];
			const controller = new AbortController();
			const fresh = {
				...options,
				signal: controller.signal,
				redirectUrl: "http://127.0.0.1:12345/callback/new",
			};
			const flow = await stage(fresh, "new".repeat(CREDENTIAL_PIECE_CHARS));
			if (mode === "cancel") controller.abort();
			if (mode === "partial")
				secrets.set.mockImplementation(async (name, value) => {
					if (name.endsWith("/1"))
						return err({ code: "secret_failed", message: "RAW_SECRET_ERROR" });
					data.set(name, value);
					return ok(undefined);
				});
			if (mode === "issuer")
				await expect(
					Promise.resolve().then(() =>
						flow.provider.saveTokens(
							{
								access_token: "evil",
								token_type: "Bearer",
								issuer: "https://evil.example",
							},
							{ issuer },
						),
					),
				).rejects.toThrow();
			const committed = await flow.commit();
			expect(committed.ok).toBe(false);
			expect(JSON.stringify(committed)).not.toContain("RAW_SECRET_ERROR");
			expect([...data]).toEqual(before);
		},
	);

	it("reuses stamped saved tokens for refresh but cannot re-register or redirect", async () => {
		const { options } = setup();
		await (await stage(options)).commit();
		const saved = await oauthSignIn({ ...options, interactive: false });
		if (!saved.ok) throw new Error("fixture saved flow unavailable");
		expect(saved.value.provider.saveClientInformation).toBeUndefined();
		expect((await saved.value.provider.tokens())?.issuer).toBe(issuer);
		await expect(
			Promise.resolve().then(() =>
				saved.value.provider.redirectToAuthorization(
					new URL("https://issuer.example/authorize"),
				),
			),
		).rejects.toThrow();
		expect((await saved.value.commit()).ok).toBe(false);
	});

	it("uses a new registration for a different explicit redirect", async () => {
		const { options } = setup();
		await (await stage(options)).commit();
		const fresh = await oauthSignIn({
			...options,
			redirectUrl: "http://127.0.0.1:23456/callback/new",
		});
		if (!fresh.ok) throw new Error("fixture fresh flow unavailable");
		expect(await fresh.value.provider.clientInformation()).toBeUndefined();
		expect(await fresh.value.provider.tokens()).toBeUndefined();
		expect(fresh.value.provider.saveClientInformation).toBeDefined();
	});

	it.each([
		{ interactive: false },
		{ interactive: true },
		{ interactive: false, redirectUrl: REDIRECT_URL },
	])("reuses desktop credentials for a later host %j", async (host) => {
		const { options, secrets } = setup();
		const desktopRedirect = "http://127.0.0.1:23456/callback/desktop";
		await (await stage({ ...options, redirectUrl: desktopRedirect })).commit();
		const reopened = await oauthSignIn({ ...options, ...host });
		if (!reopened.ok) throw new Error("fixture reopened flow unavailable");
		expect(reopened.value.provider.redirectUrl).toBe(desktopRedirect);
		expect(await reopened.value.provider.clientInformation()).toMatchObject({
			client_id: "client",
			issuer,
		});
		expect(await reopened.value.provider.tokens()).toMatchObject({
			access_token: "sentinel-token",
			issuer,
		});
		if (host.interactive)
			expect(reopened.value.provider.saveClientInformation).toBeDefined();
		else expect(reopened.value.provider.saveClientInformation).toBeUndefined();
		await reopened.value.provider.saveTokens(
			{ access_token: "refreshed", token_type: "Bearer", issuer },
			{ issuer },
		);
		expect(await reopened.value.commit()).toEqual(ok(undefined));
		const target = await oauthTarget(workspaceDir, server);
		if (!target.ok) throw new Error("fixture target unavailable");
		const stored = await readOAuthRecord(
			secrets,
			target.value.name,
			target.value.resource,
		);
		expect(stored.ok && stored.value).toMatchObject({
			redirectUrl: desktopRedirect,
			tokens: { access_token: "refreshed" },
		});
	});

	it("stages new explicit sign-in even when its redirect equals the saved redirect", async () => {
		const { options, data } = setup();
		await (await stage(options)).commit();
		const before = [...data];
		const fresh = await oauthSignIn({ ...options, redirectUrl: REDIRECT_URL });
		if (!fresh.ok) throw new Error("fixture explicit flow unavailable");
		expect(await fresh.value.provider.tokens()).toBeUndefined();
		expect(fresh.value.provider.saveClientInformation).toBeDefined();
		expect([...data]).toEqual(before);
	});

	it("persists live rotations in order and keeps cached tokens unchanged until saved", async () => {
		const { options, secrets, data } = setup();
		const flow = await stage(options, "initial");
		expect(await flow.commit()).toEqual(ok(undefined));
		let entered = () => {};
		let release = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let publications = 0;
		secrets.set.mockImplementation(async (name, value) => {
			if (name.endsWith("/manifest") && publications++ === 0) {
				entered();
				await gate;
			}
			data.set(name, value);
			return ok(undefined);
		});
		const save = (access_token: string) =>
			flow.provider.saveTokens(
				{ access_token, token_type: "Bearer", issuer },
				{ issuer },
			);
		const first = save("rotated-1");
		await started;
		const second = save("rotated-2");
		const drain = createCredentialRecords(secrets).settled();
		expect((await flow.provider.tokens())?.access_token).toBe("initial");
		release();
		await Promise.all([first, second]);
		expect(await drain).toEqual(ok(undefined));
		expect((await flow.provider.tokens())?.access_token).toBe("rotated-2");
		const fresh = await oauthSignIn({ ...options, interactive: false });
		if (!fresh.ok) throw new Error("Rotated record unavailable");
		expect((await fresh.value.provider.tokens())?.access_token).toBe(
			"rotated-2",
		);
		expect(await flow.commit()).toEqual(ok(undefined));
	});

	it("retains the live token after save failure and permits a later successful rotation", async () => {
		const { options, secrets, data } = setup();
		const flow = await stage(options, "initial");
		await flow.commit();
		secrets.set.mockResolvedValue(
			err({ code: "secret_failed", message: "RAW_SECRET_ERROR" }),
		);
		const save = (access_token: string) =>
			flow.provider.saveTokens(
				{ access_token, token_type: "Bearer", issuer },
				{ issuer },
			);
		await expect(Promise.resolve().then(() => save("failed"))).rejects.toThrow(
			"MCP OAuth credential commit failed",
		);
		expect((await flow.provider.tokens())?.access_token).toBe("initial");
		// The refused write never published; no unresolved cleanup remains to drain.
		expect((await createCredentialRecords(secrets).settled()).ok).toBe(true);
		secrets.set.mockImplementation(async (name, value) => {
			data.set(name, value);
			return ok(undefined);
		});
		await save("rotated");
		expect(await createCredentialRecords(secrets).settled()).toEqual(
			ok(undefined),
		);
		const fresh = await oauthSignIn({ ...options, interactive: false });
		if (!fresh.ok) throw new Error("Rotated record unavailable");
		expect((await fresh.value.provider.tokens())?.access_token).toBe("rotated");
	});

	it.each(["client", "issuer context"])(
		"refuses %s changes during a live rotation",
		async (changed) => {
			const { options, data } = setup();
			const flow = await stage(options);
			await flow.commit();
			const before = [...data];
			await expect(
				Promise.resolve().then(() =>
					flow.provider.saveClientInformation?.(
						{
							client_id: changed === "client" ? "different-client" : "client",
							issuer,
						},
						{
							issuer:
								changed === "issuer context" ? "https://evil.example" : issuer,
						},
					),
				),
			).rejects.toThrow();
			expect([...data]).toEqual(before);
		},
	);

	it("reports staging cleanup failure as committed rather than a failed publication", async () => {
		const { options, secrets } = setup();
		const flow = await stage(options);
		secrets.delete.mockImplementation(async (name) =>
			name.endsWith("/staging")
				? err({ code: "secret_failed", message: "RAW_SECRET_ERROR" })
				: ok(false),
		);
		expect(await flow.commit()).toEqual(
			err({
				code: "io",
				message: "MCP OAuth credentials committed; cleanup incomplete",
			}),
		);
		expect(await oauthConfigured(secrets, workspaceDir, server)).toEqual(
			ok(true),
		);
	});

	it.each(["wrong-route", "duplicate", "denied", "issuer"])(
		"rejects %s callbacks without reflecting input",
		async (mode) => {
			const { options } = setup();
			const flow = await stage(options);
			const state = await flow.provider.state?.();
			const callback = new URL(REDIRECT_URL);
			callback.searchParams.set("state", state ?? "");
			callback.searchParams.set("code", "good");
			if (mode === "wrong-route") callback.pathname = "/evil";
			if (mode === "duplicate")
				callback.searchParams.append("code", "ATTACKER_TEXT");
			if (mode === "denied")
				callback.searchParams.set("error", "ATTACKER_TEXT");
			if (mode === "issuer")
				callback.searchParams.set("iss", "https://evil.example");
			const result = flow.codeFrom(callback.href);
			expect(result.ok).toBe(false);
			expect(JSON.stringify(result)).not.toContain("ATTACKER_TEXT");
		},
	);

	it.each(["resource", "clientId", "issuer", "redirectUrl"])(
		"fails closed on stored %s metadata corruption",
		async (field) => {
			const { options, secrets } = setup();
			await (await stage(options)).commit();
			const target = await oauthTarget(workspaceDir, server);
			if (!target.ok) throw new Error("fixture target unavailable");
			const record = await readOAuthRecord(
				secrets,
				target.value.name,
				target.value.resource,
			);
			if (!record.ok || !record.value)
				throw new Error("fixture record unavailable");
			const replacement: Record<string, string> = {
				resource: "https://mcp.example/other",
				clientId: "different",
				issuer: "https://evil.example",
				redirectUrl: "https://evil.example/callback",
			};
			await createCredentialRecords(secrets).write(
				target.value.name,
				JSON.stringify({ ...record.value, [field]: replacement[field] }),
				signal,
			);
			expect((await oauthConfigured(secrets, workspaceDir, server)).ok).toBe(
				false,
			);
		},
	);
});
