import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	type ChatRequest,
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonProviderModelsResultSchema,
	DaemonProviderTestResultSchema,
	err,
	type ProviderAdapter,
	type SecretsMaskAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	ErrorCodes,
	type MessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { daemonCommand } from "../src/application/daemon.js";
import {
	endpointModels,
	probeModels,
} from "../src/application/provider-test.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// mete/provider.models and mete/provider.test (ADR-087): a custom endpoint's models, and one probe
// per model sent to its adapter directly, through the daemon and on the functions behind it.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const ID = "custom:my-lab";
const finish = {
	type: "finish",
	reason: "stop",
	usage: { prompt: 1, completion: 1 },
} as const;

const serve = async (seen: ChatRequest[]) => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	const lab = scriptedProvider({ script: [[finish]], seen }, { id: ID });
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		templatesDir: join(repo.globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		// A module id is kebab-case, so the scripted module gets one; its adapter keeps custom:my-lab.
		providers: [{ ...lab, manifest: { ...lab.manifest, id: "provider-lab" } }],
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
	const serving = daemonCommand(
		app.value,
		recordingIo().io,
		repo.workspaceDir,
		{
			input: toDaemon,
			output: toClient,
		},
	);
	const c = createMessageConnection(
		new StreamMessageReader(toClient),
		new StreamMessageWriter(toDaemon),
	);
	c.listen();
	close = async () => {
		toDaemon.end();
		await serving;
		c.dispose();
		await app.value.stop();
		await repo.close();
	};
	return c;
};

const refusal = (c: MessageConnection, method: string, params: unknown) =>
	c.sendRequest(method, params).then(
		() => undefined,
		(e: unknown) => e as { code: number; data?: unknown },
	);

describe("mete/provider.models and mete/provider.test", () => {
	it("lists the endpoint's models and probes each model once with ping", async () => {
		const seen: ChatRequest[] = [];
		const c = await serve(seen);
		const listed = DaemonProviderModelsResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.providerModels, { providerId: ID }),
		);
		expect("models" in listed && listed.models.map((m) => m.id)).toEqual([
			"coder-1",
		]);
		const tested = DaemonProviderTestResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.providerTest, {
				providerId: ID,
				models: ["coder-1"],
			}),
		);
		expect(tested.results).toEqual([
			{ modelId: "coder-1", ok: true, ms: expect.any(Number) },
		]);
		// No token cap: a run sends none, and a capped stream may fail where runs work (ADR-153).
		expect(seen).toEqual([
			{
				model: "coder-1",
				messages: [{ role: "user", content: "ping" }],
			},
		]);
	});

	it("answers not_found for an endpoint that is not loaded, and refuses a built-in provider id", async () => {
		const c = await serve([]);
		const other = { providerId: "custom:other" };
		for (const [method, params] of [
			[DAEMON_METHODS.providerModels, other],
			[DAEMON_METHODS.providerTest, { ...other, models: ["m"] }],
		] as const) {
			const missing = await refusal(c, method, params);
			expect(missing?.code).toBe(DAEMON_ERROR_CODE);
			expect(missing?.data).toEqual({ code: "not_found" });
		}
		const bad = await refusal(c, DAEMON_METHODS.providerModels, {
			providerId: "groq",
		});
		expect(bad?.code).toBe(ErrorCodes.InvalidParams);
	});
});

// Built at runtime so no secret-shaped literal sits in the repository.
const token = () => `ghp_${"A1b2C3d4E5".repeat(3)}aBcDeF`;
const mask: SecretsMaskAdapter = {
	mask: async (text) => ({
		text: text.replace(token(), "[SECRET:00000000]"),
		masked: 1,
	}),
};
const failing: ProviderAdapter = {
	id: ID,
	format: "openai-chat",
	listModels: async () =>
		err({
			code: "unauthorized",
			message: `bad key ${token()}`,
			status: 401,
			headers: new Headers({ "x-request-id": "r1" }),
		}),
	async *chat() {
		yield {
			type: "error",
			error: { code: "network", message: `fetch failed for ${token()}` },
		};
	},
	quotaUnits: () => [],
	observe: () => [],
	privacy: () => ({ trains: false, logs: false, publishes: false }),
};

describe("a failing custom endpoint", () => {
	it("answers the listing's code and status with the message masked, and no headers", async () => {
		expect(await endpointModels(failing, mask)).toEqual({
			failed: {
				code: "unauthorized",
				message: "bad key [SECRET:00000000]",
				status: 401,
			},
		});
	});

	it("answers each probe's error chunk in the order asked, masked", async () => {
		const failed = {
			code: "network",
			message: "fetch failed for [SECRET:00000000]",
		};
		expect(await probeModels(failing, ["a", "b"], mask)).toEqual({
			results: [
				{ modelId: "a", ok: false, failed },
				{ modelId: "b", ok: false, failed },
			],
		});
	});
});
