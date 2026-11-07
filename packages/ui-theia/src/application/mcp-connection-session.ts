import {
	err,
	type McpConnectionRequest,
	type McpConnectionState,
	McpConnectionStateSchema,
	type McpCredentialField,
	McpCredentialFieldSchema,
	type McpCredentialWrite,
	McpCredentialWriteSchema,
	type McpServer,
	McpServerSchema,
	type McpSignInStarted,
	McpSignInStartedSchema,
	type Result,
} from "@mete/contracts";
import type { DaemonFailure } from "../domain/status-service.js";

/** Captured settings target; neither a scope switch nor an edit inherits a sign-in. */
export type McpConnectionTarget = {
	readonly dir: string;
	readonly scope: string;
	readonly expected: McpServer;
};
/** All values are transient write-only form input, never loaded from the keychain. */
export type McpConnectionViewState = {
	readonly busy: boolean;
	readonly dirty: boolean;
	readonly connection: McpConnectionState | undefined;
	readonly values: Readonly<Record<string, string>>;
	readonly fields: readonly McpCredentialField[];
	readonly error:
		| "unavailable"
		| "invalid"
		| "required"
		| "restart"
		| undefined;
};
type Deps = {
	readonly connection: (
		dir: string,
		input: McpConnectionRequest,
	) => Promise<Result<McpSignInStarted, DaemonFailure>>;
	readonly credentials: (
		dir: string,
		input: McpCredentialWrite,
	) => Promise<Result<null, DaemonFailure>>;
	readonly restart: (dir: string) => Promise<Result<null, DaemonFailure>>;
	readonly open: (url: string) => void;
	readonly changed: () => void;
	readonly schedule: (callback: () => void) => () => void;
};
type Captured = McpConnectionTarget & {
	starting: boolean;
	mutation: boolean;
	attempt: string | undefined;
	stop?: (() => void) | undefined;
	cleanup?: Promise<void> | undefined;
};
const empty = (): McpConnectionViewState => ({
	busy: false,
	dirty: false,
	connection: undefined,
	values: {},
	fields: [],
	error: undefined,
});
const fieldKey = (field: McpCredentialField) => `${field.kind}:${field.name}`;
const safe = async <T>(call: () => Promise<Result<T, DaemonFailure>>) => {
	try {
		return await call();
	} catch {
		return err<DaemonFailure>({ code: "protocol", detail: "" });
	}
};
const capture = (input: McpConnectionTarget): Captured | undefined => {
	const parsed = McpServerSchema.safeParse(input.expected);
	return parsed.success && input.dir
		? {
				...input,
				expected: parsed.data,
				starting: false,
				mutation: false,
				attempt: undefined,
			}
		: undefined;
};

/** Local polling, explicit browser intent and exact-target cancellation (ADR-184). */
export class McpConnectionSession {
	private target: Captured | undefined;
	private value = empty();
	constructor(private readonly deps: Deps) {}
	get state(): McpConnectionViewState {
		return this.value;
	}
	get canConnect() {
		const t = this.target,
			s = this.value;
		if (!t || s.busy || s.dirty || s.error || s.connection?.phase === "pending")
			return false;
		if (
			s.fields.some(
				(f) =>
					f.required &&
					!s.connection?.fields.some(
						(saved) => fieldKey(saved) === fieldKey(f) && saved.configured,
					),
			)
		)
			return false;
		return (
			t.expected.transport === "stdio" ||
			t.expected.auth !== "oauth" ||
			["configured", "untested", "connected"].includes(
				s.connection?.phase ?? "",
			)
		);
	}
	private put(patch: Partial<McpConnectionViewState>) {
		this.value = { ...this.value, ...patch };
		this.deps.changed();
	}
	async show(input: McpConnectionTarget): Promise<void> {
		if (
			JSON.stringify(input) ===
			JSON.stringify(
				this.target && {
					dir: this.target.dir,
					scope: this.target.scope,
					expected: this.target.expected,
				},
			)
		)
			return;
		const previous = this.target;
		const target = capture(input);
		this.target = target;
		this.value = {
			...empty(),
			fields: target?.expected.credentialFields ?? [],
		};
		this.deps.changed();
		if (previous && !previous.starting) await this.cleanup(previous, true);
		if (target && this.target === target) await this.run("status");
	}
	async clear(): Promise<void> {
		const previous = this.target;
		this.target = undefined;
		this.value = empty();
		this.deps.changed();
		if (previous && !previous.starting) await this.cleanup(previous, true);
	}
	type(key: string, value: string) {
		if (
			!this.target ||
			this.value.busy ||
			!this.value.fields.some((f) => fieldKey(f) === key)
		)
			return;
		const values = { ...this.value.values };
		if (value) values[key] = value;
		else delete values[key];
		this.put({ values, dirty: true, error: undefined });
	}
	addField(name: string, secret: boolean) {
		const expected = this.target?.expected;
		if (!expected || this.value.busy) return;
		const kind = expected.transport === "stdio" ? "env" : "header";
		const field = McpCredentialFieldSchema.safeParse({
			kind,
			name: name.trim(),
			required: false,
			secret,
		});
		const reserved =
			/^(host|connection|content-length|transfer-encoding|proxy-authorization|cookie)$/i;
		if (
			!field.success ||
			(kind === "header" &&
				(reserved.test(name.trim()) ||
					(expected.transport !== "stdio" &&
						expected.auth === "oauth" &&
						/^authorization$/i.test(name.trim()))))
		)
			return this.put({ error: "invalid" });
		const fields = McpCredentialWriteSchema.shape.fields.safeParse([
			...this.value.fields,
			field.data,
		]);
		if (!fields.success) return this.put({ error: "invalid" });
		this.put({ fields: fields.data, dirty: true, error: undefined });
	}
	async save(): Promise<void> {
		const target = this.target;
		if (!target || this.value.busy) return;
		const input = McpCredentialWriteSchema.safeParse({
			expected: target.expected,
			fields: this.value.fields,
			values: this.value.values,
		});
		if (!input.success)
			return this.put({
				error: this.value.fields.some(
					(f) => f.required && !this.value.values[fieldKey(f)],
				)
					? "required"
					: "invalid",
			});
		this.put({ busy: true, error: undefined });
		const result = await safe(() =>
			this.deps.credentials(target.dir, input.data),
		);
		if (this.target !== target) return;
		if (!result.ok) return this.put({ busy: false, error: "unavailable" });
		this.put({
			busy: false,
			values: {},
			dirty: false,
			error: undefined,
			connection: undefined,
		});
		await this.run("status");
	}
	async run(op: "status" | "start" | "forget" | "cancel"): Promise<void> {
		const target = this.target;
		if (!target || this.value.busy || (op === "cancel" && !target.attempt))
			return;
		target.stop?.();
		if (op === "start" || op === "forget") target.cleanup = undefined;
		target.starting = op === "start" || op === "forget";
		target.mutation ||= target.starting;
		this.put({ busy: true, error: undefined });
		const input: McpConnectionRequest =
			op === "cancel"
				? { op, expected: target.expected, attemptId: target.attempt ?? "" }
				: { op, expected: target.expected };
		const result = await safe(() => this.deps.connection(target.dir, input));
		target.starting = false;
		if (result.ok) this.captureAttempt(target, result.value.state);
		if (this.target !== target) return this.cleanup(target, true);
		await this.receive(target, result, op);
	}
	private async receive(
		target: Captured,
		result: Result<McpSignInStarted, DaemonFailure>,
		op: string,
	) {
		const parsed = result.ok
			? McpSignInStartedSchema.safeParse(result.value)
			: undefined;
		if (!parsed?.success || parsed.data.state.id !== target.expected.id)
			return this.failed(target, result.ok ? "invalid" : "unavailable");
		await this.accept(target, parsed.data, op);
	}
	private captureAttempt(target: Captured, raw: unknown) {
		const state = McpConnectionStateSchema.safeParse(raw);
		if (!state.success || state.data.id !== target.expected.id) return;
		if (
			state.data.phase === "pending" &&
			target.attempt !== state.data.attemptId
		)
			target.cleanup = undefined;
		target.attempt = state.data.attemptId;
		target.mutation ||= state.data.phase === "pending";
	}
	private async accept(target: Captured, result: McpSignInStarted, op: string) {
		const connection = result.state;
		if (op === "forget")
			this.put({
				values: {},
				dirty: false,
				fields: target.expected.credentialFields ?? [],
			});
		const fields = new Map(this.value.fields.map((f) => [fieldKey(f), f]));
		for (const { configured: _configured, ...field } of connection.fields)
			if (!fields.has(fieldKey(field))) fields.set(fieldKey(field), field);
		this.put({
			busy: connection.phase !== "pending",
			connection,
			fields: [...fields.values()],
		});
		if (connection.phase !== "pending") {
			await this.cleanup(target, false);
			if (this.target === target) this.put({ busy: false });
			return;
		}
		await this.poll(target, result, op);
	}
	private async poll(target: Captured, result: McpSignInStarted, op: string) {
		if (!result.state.attemptId || (op === "start" && !result.authorizationUrl))
			return this.failed(target, "invalid");
		try {
			if (op === "start" && result.authorizationUrl)
				this.deps.open(result.authorizationUrl);
		} catch {
			return this.failed(target, "unavailable");
		}
		target.stop = this.deps.schedule(() => {
			if (this.target === target) void this.run("status");
		});
	}
	private async failed(
		target: Captured,
		error: McpConnectionViewState["error"],
	) {
		this.put({ busy: true, error });
		await this.cleanup(target, true);
		if (this.target === target) this.put({ busy: false });
	}
	private cleanup(target: Captured, cancel: boolean): Promise<void> {
		target.stop?.();
		if (target.cleanup) return target.cleanup;
		if (!target.mutation) return Promise.resolve();
		target.cleanup = this.retire(target, cancel);
		return target.cleanup;
	}
	private async retire(target: Captured, cancel: boolean) {
		const cancelled =
			cancel && target.attempt
				? await safe(() =>
						this.deps.connection(target.dir, {
							op: "cancel",
							expected: target.expected,
							attemptId: target.attempt ?? "",
						}),
					)
				: undefined;
		const restarted = await safe(() => this.deps.restart(target.dir));
		const error = !restarted.ok
			? "restart"
			: cancelled && !cancelled.ok
				? "unavailable"
				: undefined;
		if (error) target.cleanup = undefined;
		if (this.target === target && error) this.put({ error });
	}
}
