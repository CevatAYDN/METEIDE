import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	err,
	type McpConnectionAdapter,
	type McpConnectionState,
	type McpServer,
	type McpSignInStarted,
	ok,
	type Result,
	type ToolError,
} from "@mete/contracts";
import { OAUTH_TIMEOUT_MS } from "../defaults.js";
import {
	type CredentialFields,
	createCredentialFields,
} from "../infrastructure/credential-fields.js";
import {
	credentialIdentity,
	credentialTargetAllowed,
} from "../infrastructure/credential-identity.js";
import { forgetOAuth, oauthConfigured } from "../infrastructure/oauth.js";
import {
	type OAuthCallback,
	openOAuthCallback,
} from "../infrastructure/oauth-callback.js";
import { createSessions, type SessionDeps } from "./sessions.js";

type Answer<T> = Result<T, ToolError>;
type Pending = {
	readonly controller: AbortController;
	readonly identity: string;
	readonly attemptId: string;
	readonly done: Promise<void>;
};
type Deps = {
	readonly sessionDeps: SessionDeps;
	readonly retire: () => Promise<void>;
};
const failed = (message: string) => err<ToolError>({ code: "io", message });

const fieldStates = (loaded: CredentialFields | undefined, server: McpServer) =>
	(loaded?.fields ?? server.credentialFields ?? []).map((field) => ({
		...field,
		configured: Boolean(loaded?.values[`${field.kind}:${field.name}`]),
	}));
const localPhase = (
	server: McpServer,
	fields: McpConnectionState["fields"],
	configured: boolean,
	oauth: boolean,
) => {
	if (fields.some((f) => f.required && !f.configured))
		return "needs_credentials";
	if (server.transport !== "stdio" && server.auth === "oauth" && !oauth)
		return "needs_sign_in";
	return configured || oauth ? "configured" : "untested";
};

class McpConnection {
	private readonly fields;
	private readonly states = new Map<string, McpConnectionState>();
	private pending: Pending | undefined;
	private busy = false;
	private closed = false;
	private readonly lifecycle = new AbortController();

	constructor(private readonly options: Deps) {
		const { secrets, workspaceDir } = options.sessionDeps;
		this.fields = secrets
			? createCredentialFields(secrets, workspaceDir)
			: undefined;
	}

	private async identityOf(server: McpServer) {
		const deps = this.options.sessionDeps;
		if (
			!isDeepStrictEqual(
				deps.servers.find((s) => s.id === server.id),
				server,
			)
		)
			return failed("The MCP configuration changed");
		return credentialIdentity(deps.workspaceDir, server);
	}

	readonly status: McpConnectionAdapter["status"] = async (server) => {
		const identity = await this.identityOf(server);
		if (!identity.ok) return identity;
		const known = this.states.get(identity.value);
		if (known) return ok(known);
		const { secrets, workspaceDir } = this.options.sessionDeps;
		if (!secrets || !this.fields)
			return failed("The operating-system keychain is unavailable");
		const loaded = await this.fields.load(server);
		if (!loaded.ok) return loaded;
		const oauth = await oauthConfigured(secrets, workspaceDir, server);
		if (!oauth.ok) return oauth;
		const fields = fieldStates(loaded.value, server);
		const phase = localPhase(
			server,
			fields,
			Boolean(loaded.value),
			oauth.value,
		);
		return ok({ id: server.id, identity: identity.value, phase, fields });
	};

	private async exclusive<T>(
		run: () => Promise<Answer<T>>,
	): Promise<Answer<T>> {
		if (this.closed || this.busy || this.pending)
			return failed("MCP connection management is busy");
		this.busy = true;
		try {
			return await run();
		} catch {
			return failed("MCP connection action failed");
		} finally {
			this.busy = false;
		}
	}

	readonly start: McpConnectionAdapter["start"] = (server, signal) =>
		this.exclusive(async () => {
			const active = AbortSignal.any([signal, this.lifecycle.signal]);
			if (
				server.transport === "stdio" ||
				server.auth !== "oauth" ||
				!credentialTargetAllowed(server)
			)
				return failed("This server does not support secure OAuth sign-in");
			const before = await this.status(server, signal);
			if (!before.ok) return before;
			await this.options.retire();
			if (active.aborted) return failed("MCP sign-in was cancelled");
			const flow = launchSignIn({
				deps: this.options.sessionDeps,
				server,
				before: before.value,
				parent: active,
				publish: (state) => this.states.set(state.identity, state),
			});
			this.pending = { ...flow, identity: before.value.identity };
			void flow.done.then(() => {
				if (this.pending?.attemptId === flow.attemptId)
					this.pending = undefined;
			});
			return flow.started;
		});

	readonly cancel: McpConnectionAdapter["cancel"] = async (
		server,
		attemptId,
	) => {
		const identity = await this.identityOf(server);
		if (!identity.ok) return identity;
		const flow = this.pending;
		if (
			!flow ||
			flow.identity !== identity.value ||
			flow.attemptId !== attemptId
		)
			return failed("This sign-in attempt is no longer pending");
		flow.controller.abort("cancelled");
		await flow.done;
		return this.status(server, new AbortController().signal);
	};

	readonly forget: McpConnectionAdapter["forget"] = (server, signal) =>
		this.exclusive(async () => {
			const identity = await this.identityOf(server);
			if (!identity.ok) return identity;
			const { secrets, workspaceDir } = this.options.sessionDeps;
			if (!secrets || !this.fields || signal.aborted)
				return failed("Credential cleanup is unavailable");
			await this.options.retire();
			const oauth = await forgetOAuth(secrets, workspaceDir, server);
			const local = await this.fields.forget(server);
			this.states.delete(identity.value);
			if (!oauth.ok || !local.ok)
				return failed("Credential cleanup is incomplete; retry");
			return this.status(server, signal);
		});

	readonly configure: McpConnectionAdapter["configure"] = (input, signal) =>
		this.exclusive(async () => {
			const identity = await this.identityOf(input.expected);
			if (!identity.ok) return identity;
			if (!this.fields)
				return failed("The operating-system keychain is unavailable");
			await this.options.retire();
			const saved = await this.fields.save(input, signal);
			if (!saved.ok) return saved;
			this.states.delete(identity.value);
			return this.status(input.expected, signal);
		});

	readonly adapter: McpConnectionAdapter = {
		status: this.status,
		start: this.start,
		cancel: this.cancel,
		forget: this.forget,
		configure: this.configure,
	};
	readonly close = async () => {
		this.closed = true;
		this.lifecycle.abort("cancelled");
		this.pending?.controller.abort("cancelled");
		await this.pending?.done;
	};
}

/** Separate user-management sessions never lend a pending authorization to an agent. */
export const createMcpConnection = (options: Deps) =>
	new McpConnection(options);

const launchSignIn = ({
	deps,
	server,
	before,
	parent,
	publish,
}: {
	deps: SessionDeps;
	server: McpServer;
	before: McpConnectionState;
	parent: AbortSignal;
	publish: (state: McpConnectionState) => void;
}) => {
	const controller = new AbortController();
	const attemptId = randomUUID();
	const state: McpConnectionState = {
		id: before.id,
		identity: before.identity,
		fields: before.fields,
		phase: "pending",
		attemptId,
		expiresAt: new Date(Date.now() + OAUTH_TIMEOUT_MS).toISOString(),
	};
	publish(state);
	let answer: (value: Answer<McpSignInStarted>) => void = () => {};
	const started = new Promise<Answer<McpSignInStarted>>((resolve) => {
		answer = resolve;
	});
	const signal = AbortSignal.any([controller.signal, parent]);
	const timer = setTimeout(() => controller.abort("expired"), OAUTH_TIMEOUT_MS);
	const done = runSignIn({ deps, server, state, signal, answer, publish })
		.catch(() => {
			const failedState = {
				...state,
				phase: "failed" as const,
				failure: "sign_in_failed" as const,
			};
			publish(failedState);
			answer(ok({ state: failedState }));
		})
		.finally(() => clearTimeout(timer));
	return { controller, attemptId, started, done };
};

type SignInJob = {
	readonly deps: SessionDeps;
	readonly server: McpServer;
	readonly state: McpConnectionState;
	readonly signal: AbortSignal;
	readonly answer: (value: Answer<McpSignInStarted>) => void;
	readonly publish: (state: McpConnectionState) => void;
};

const browserAuthorization =
	(job: SignInJob, callback: OAuthCallback, state: { value: string }) =>
	async (_id: string, url: string) => {
		const address = new URL(url);
		if (address.protocol !== "https:" || address.username || address.password)
			return undefined;
		state.value = address.searchParams.get("state") ?? "";
		job.answer(ok({ state: job.state, authorizationUrl: address.href }));
		const landed = await callback.wait();
		return landed.ok ? landed.value : undefined;
	};

const signInOutcome = (
	job: SignInJob,
	connected: boolean,
): McpConnectionState => {
	if (connected) return { ...job.state, phase: "connected" };
	if (!job.signal.aborted)
		return { ...job.state, phase: "failed", failure: "sign_in_failed" };
	const phase = job.signal.reason === "expired" ? "expired" : "cancelled";
	return { ...job.state, phase, failure: phase };
};

const runSignIn = async (job: SignInJob) => {
	const stateValue = { value: "" };
	const callback = await openOAuthCallback({
		signal: job.signal,
		validate: (url) => {
			const params = new URL(url).searchParams;
			return stateValue.value && params.get("state") === stateValue.value
				? ok(undefined)
				: err("The callback does not belong to this sign-in");
		},
	});
	if (!callback.ok) {
		job.publish({ ...job.state, phase: "failed", failure: "sign_in_failed" });
		job.answer(callback);
		return;
	}
	const sessions = createSessions({
		...job.deps,
		oauthRedirectUrl: callback.value.redirectUrl,
		authorize: browserAuthorization(job, callback.value, stateValue),
	});
	let state: McpConnectionState;
	try {
		const connected = await sessions.get(job.server.id, job.signal);
		state = signInOutcome(job, connected.ok);
	} finally {
		await callback.value.close();
		await sessions.close();
	}
	const drained = await sessions.drain();
	if (!drained.ok)
		state = { ...job.state, phase: "failed", failure: "credentials_failed" };
	job.publish(state);
	job.answer(ok({ state }));
};
