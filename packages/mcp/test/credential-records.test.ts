import { err, ok, type SecretStore } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	CREDENTIAL_MAX_PIECES,
	CREDENTIAL_PIECE_CHARS,
} from "../src/defaults.js";
import { createCredentialRecords } from "../src/infrastructure/credential-records.js";

const signal = new AbortController().signal;
const failure = err({
	code: "secret_failed" as const,
	message: "PRIVATE_SENTINEL",
});
const setup = () => {
	const data = new Map<string, string>();
	const secrets = {
		get: vi.fn<SecretStore["get"]>(async (key) => ok(data.get(key))),
		set: vi.fn<SecretStore["set"]>(async (key, value) => {
			data.set(key, value);
			return ok(undefined);
		}),
		delete: vi.fn<SecretStore["delete"]>(async (key) => ok(data.delete(key))),
	};
	return { data, secrets, records: createCredentialRecords(secrets) };
};

const deferred = () => {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

describe("credential records", () => {
	it.each([false, true])(
		"restores after late cancellation and retains cleanup metadata (delete failure=%s)",
		async (failCleanup) => {
			const { records, secrets, data } = setup();
			await records.write("late-cancel", "old", signal);
			const held = Promise.withResolvers<void>();
			const entered = Promise.withResolvers<void>();
			let hold = true;
			secrets.delete.mockImplementation(async (key) => {
				if (hold && key === "late-cancel/staging") {
					hold = false;
					entered.resolve();
					await held.promise;
				}
				if (failCleanup && data.get(key) === "new") return failure;
				return ok(data.delete(key));
			});
			const controller = new AbortController();
			const writing = records.write("late-cancel", "new", controller.signal);
			await entered.promise;
			controller.abort();
			held.resolve();
			expect((await writing).ok).toBe(false);
			expect((await records.settled()).ok).toBe(!failCleanup);
			expect(await records.read("late-cancel")).toEqual(ok("old"));
			secrets.delete.mockImplementation(async (key) => ok(data.delete(key)));
			expect(
				await createCredentialRecords(secrets).delete("late-cancel"),
			).toEqual(ok(undefined));
			expect(data.size).toBe(0);
		},
	);
	it.each([undefined, "old"])(
		"restores %s after cancellation during publication before draining",
		async (prior) => {
			const { records, secrets, data } = setup();
			if (prior !== undefined) await records.write("p", prior, signal);
			const entered = deferred();
			const release = deferred();
			let publications = 0;
			secrets.set.mockImplementation(async (key, value) => {
				if (key.endsWith("/manifest") && publications++ === 0) {
					entered.resolve();
					await release.promise;
				}
				data.set(key, value);
				return ok(undefined);
			});
			const controller = new AbortController();
			const write = records.write("p", "new", controller.signal);
			await entered.promise;
			controller.abort();
			const peer = createCredentialRecords(secrets);
			let drained = false;
			const settled = peer.settled().then((result) => {
				drained = true;
				return result;
			});
			await Promise.resolve();
			expect(drained).toBe(false);
			release.resolve();
			expect(await write).toEqual(
				err({ code: "secret_failed", message: "Credential write cancelled" }),
			);
			expect(await settled).toEqual(ok(undefined));
			expect(await peer.read("p")).toEqual(ok(prior));
			expect(data.has("p/staging")).toBe(false);
		},
	);

	it("retains rollback failure across drains until a later successful mutation", async () => {
		const { records, secrets, data } = setup();
		await records.write("p", "old", signal);
		const prior = [...data];
		const entered = deferred();
		const release = deferred();
		let publications = 0;
		secrets.set.mockImplementation(async (key, value) => {
			if (key.endsWith("/manifest")) {
				if (publications++ > 0) return failure;
				entered.resolve();
				await release.promise;
			}
			data.set(key, value);
			return ok(undefined);
		});
		const controller = new AbortController();
		const write = records.write("p", "new", controller.signal);
		await entered.promise;
		controller.abort();
		release.resolve();
		const result = await write;
		expect(result.ok).toBe(false);
		expect(JSON.stringify(result)).toMatch(/rollback failed/i);
		expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SENTINEL|cancelled/);
		for (const [key, value] of prior.filter(
			([key]) => !key.endsWith("/manifest"),
		))
			expect(data.get(key)).toBe(value);
		const peer = createCredentialRecords(secrets);
		expect(await peer.settled()).toEqual(result);
		await peer.read("p");
		expect(await peer.settled()).toEqual(result);
		await peer.write("p", "not-started", AbortSignal.abort());
		expect(await peer.settled()).toEqual(result);
		secrets.set.mockImplementation(async (key, value) => {
			data.set(key, value);
			return ok(undefined);
		});
		expect(await peer.write("p", "recovered", signal)).toEqual(ok(undefined));
		expect(await records.settled()).toEqual(ok(undefined));
	});

	it("keeps cancelled-publication cleanup discoverable and reports it during drain", async () => {
		const { records, secrets, data } = setup();
		await records.write("p", "old", signal);
		const controller = new AbortController();
		let publications = 0;
		secrets.set.mockImplementation(async (key, value) => {
			data.set(key, value);
			if (key.endsWith("/manifest") && publications++ === 0) controller.abort();
			return ok(undefined);
		});
		secrets.delete.mockResolvedValue(failure);
		const result = await records.write("p", "new", controller.signal);
		expect(result.ok).toBe(false);
		expect(JSON.stringify(result)).toMatch(/cleanup incomplete/);
		expect(await createCredentialRecords(secrets).settled()).toEqual(result);
		expect(await records.read("p")).toEqual(ok("old"));
		expect(data.has("p/staging")).toBe(true);
		secrets.delete.mockImplementation(async (key) => ok(data.delete(key)));
		expect(await createCredentialRecords(secrets).delete("p")).toEqual(
			ok(undefined),
		);
		expect(await records.settled()).toEqual(ok(undefined));
	});
	it("does not split a surrogate pair at a keychain chunk boundary", async () => {
		const { records, secrets, data } = setup();
		secrets.set.mockImplementation(async (key, value) => {
			data.set(key, Buffer.from(value, "utf8").toString("utf8"));
			return ok(undefined);
		});
		const value = `${"a".repeat(CREDENTIAL_PIECE_CHARS - 1)}\u{1f600}tail`;
		expect(await records.write("unicode", value, signal)).toEqual(
			ok(undefined),
		);
		expect(await records.read("unicode")).toEqual(ok(value));
	});
	it.each(["", "a".repeat(CREDENTIAL_PIECE_CHARS * CREDENTIAL_MAX_PIECES)])(
		"round-trips bounded values and publishes the manifest last",
		async (value) => {
			const { records, secrets, data } = setup();
			expect(await records.read("profile")).toEqual(ok(undefined));
			expect(await records.write("profile", value, signal)).toEqual(
				ok(undefined),
			);
			expect(await createCredentialRecords(secrets).read("profile")).toEqual(
				ok(value),
			);
			expect(secrets.set.mock.calls.at(-1)?.[0]).toBe("profile/manifest");
			expect(
				[...data.values()].every(
					(part) => part.length <= CREDENTIAL_PIECE_CHARS,
				),
			).toBe(true);
		},
	);

	it("rejects oversize and pre-cancelled writes without touching storage", async () => {
		const { records, secrets } = setup();
		const tooBig = "a".repeat(
			CREDENTIAL_PIECE_CHARS * CREDENTIAL_MAX_PIECES + 1,
		);
		expect((await records.write("p", tooBig, signal)).ok).toBe(false);
		expect((await records.write("p", "value", AbortSignal.abort())).ok).toBe(
			false,
		);
		expect(secrets.get).not.toHaveBeenCalled();
		expect(secrets.set).not.toHaveBeenCalled();
	});

	it.each(["piece", "manifest", "cancel"])(
		"preserves the previous record and cleans staged keys on %s failure",
		async (mode) => {
			const { records, secrets, data } = setup();
			await records.write("p", "old", signal);
			const before = [...data];
			const controller = new AbortController();
			const suffix = mode === "manifest" ? "/manifest" : "/1";
			secrets.set.mockImplementation(async (key, value) => {
				if (mode !== "cancel" && key.endsWith(suffix)) return failure;
				data.set(key, value);
				if (mode === "cancel") controller.abort();
				return ok(undefined);
			});
			const result = await records.write(
				"p",
				"b".repeat(CREDENTIAL_PIECE_CHARS + 1),
				controller.signal,
			);
			expect(result.ok).toBe(false);
			expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
			expect([...data]).toEqual(before);
			expect(await records.read("p")).toEqual(ok("old"));
		},
	);

	it.each([
		"not json",
		"{}",
		'{"generation":"../other","count":1,"checksum":"x"}',
	])("fails closed on malformed manifest %s", async (manifest) => {
		const { records, data, secrets } = setup();
		data.set("p/manifest", manifest);
		expect((await records.read("p")).ok).toBe(false);
		expect((await records.delete("p")).ok).toBe(false);
		expect(secrets.delete).not.toHaveBeenCalled();
	});

	it.each(["missing", "changed", "oversize", "extra", "count"])(
		"rejects %s committed data",
		async (mode) => {
			const { records, data } = setup();
			await records.write("p", "value", signal);
			const piece = [...data.keys()].find((key) => !key.endsWith("/manifest"));
			if (!piece) throw new Error("fixture has no piece");
			switch (mode) {
				case "missing":
					data.delete(piece);
					break;
				case "changed":
					data.set(piece, "wrong");
					break;
				case "oversize":
					data.set(piece, "a".repeat(CREDENTIAL_PIECE_CHARS + 1));
					break;
				default: {
					const raw = z
						.record(z.string(), z.unknown())
						.parse(JSON.parse(data.get("p/manifest") ?? ""));
					data.set(
						"p/manifest",
						JSON.stringify({
							...raw,
							...(mode === "extra"
								? { extra: true }
								: { count: CREDENTIAL_MAX_PIECES + 1 }),
						}),
					);
				}
			}
			expect((await records.read("p")).ok).toBe(false);
		},
	);

	it.each(["manifest", "piece", "throw"])(
		"sanitizes %s get failures",
		async (mode) => {
			const { records, secrets } = setup();
			await records.write("p", "value", signal);
			if (mode === "piece") {
				const manifest = secrets.set.mock.calls.at(-1)?.[1];
				secrets.get
					.mockReset()
					.mockResolvedValueOnce(ok(manifest))
					.mockResolvedValue(failure);
			} else
				secrets.get.mockImplementation(async () => {
					if (mode === "throw") throw new Error("PRIVATE_SENTINEL");
					return failure;
				});
			const result = await records.read("p");
			expect(result).toEqual(
				err({ code: "secret_failed", message: "Credential read failed" }),
			);
		},
	);

	it("refuses cleanup metadata that targets the usable generation", async () => {
		const { records, secrets, data } = setup();
		await records.write("p", "old", signal);
		secrets.delete.mockClear();
		const raw = z
			.record(z.string(), z.unknown())
			.parse(JSON.parse(data.get("p/manifest") ?? ""));
		data.set(
			"p/manifest",
			JSON.stringify({
				...raw,
				cleanup: { generation: raw.generation, count: raw.count },
			}),
		);
		expect((await records.write("p", "new", signal)).ok).toBe(false);
		expect(secrets.delete).not.toHaveBeenCalled();
	});

	it("reports committed cleanup failure and retains prior keys for a fresh instance", async () => {
		const { records, secrets, data } = setup();
		await records.write("p", "old", signal);
		secrets.delete.mockResolvedValue(failure);
		expect(await records.write("p", "new", signal)).toEqual(
			err({
				code: "secret_failed",
				message: "Credential committed; staging cleanup incomplete",
			}),
		);
		expect(await records.read("p")).toEqual(ok("new"));
		expect((await records.write("p", "blocked", signal)).ok).toBe(false);
		const restarted = createCredentialRecords(secrets);
		expect((await restarted.delete("p")).ok).toBe(false);
		expect(data.has("p/manifest")).toBe(true);
		secrets.delete.mockImplementation(async (key) => ok(data.delete(key)));
		expect(await restarted.delete("p")).toEqual(ok(undefined));
		expect(data.size).toBe(0);
	});

	it("retains failed staging cleanup across a new instance and retries deletion", async () => {
		const { records, secrets, data } = setup();
		await records.write("p", "old", signal);
		secrets.delete.mockResolvedValue(failure);
		secrets.set.mockImplementation(async (key, value) => {
			if (key.endsWith("/manifest")) return failure;
			data.set(key, value);
			return ok(undefined);
		});
		expect(await records.write("p", "failed", signal)).toEqual(
			err({
				code: "secret_failed",
				message: "Credential write failed; staged cleanup incomplete",
			}),
		);
		expect(await records.read("p")).toEqual(ok("old"));
		const restarted = createCredentialRecords(secrets);
		expect((await restarted.delete("p")).ok).toBe(false);
		expect(data.has("p/manifest")).toBe(true);
		secrets.delete.mockImplementation(async (key) => ok(data.delete(key)));
		expect(await restarted.delete("p")).toEqual(ok(undefined));
		expect(data.size).toBe(0);
	});

	it("retains the manifest after incomplete deletion and retries already removed pieces", async () => {
		const { records, secrets, data } = setup();
		await records.write("p", "a".repeat(CREDENTIAL_PIECE_CHARS + 1), signal);
		secrets.delete.mockImplementation(async (key) =>
			key.endsWith("/1") ? failure : ok(data.delete(key)),
		);
		expect((await records.delete("p")).ok).toBe(false);
		expect(data.has("p/manifest")).toBe(true);
		expect((await records.read("p")).ok).toBe(false);
		secrets.delete.mockImplementation(async (key) => ok(data.delete(key)));
		expect(await records.delete("p")).toEqual(ok(undefined));
		expect(secrets.delete.mock.calls.at(-1)?.[0]).toBe("p/manifest");
		expect(await records.delete("p")).toEqual(ok(undefined));
		expect(await records.read("p")).toEqual(ok(undefined));
	});

	it("serializes read/write/delete in invocation order while other profiles proceed", async () => {
		const { records, secrets, data } = setup();
		let release = () => {};
		let entered = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		secrets.set.mockImplementation(async (key, value) => {
			if (key.startsWith("p/") && !key.endsWith("/manifest")) {
				entered();
				await gate;
			}
			data.set(key, value);
			return ok(undefined);
		});
		const first = records.write("p", "one", signal);
		await started;
		const peer = createCredentialRecords(secrets);
		const read = peer.read("p");
		const second = peer.write("p", "two", signal);
		const remove = records.delete("p");
		expect(await records.write("other", "independent", signal)).toEqual(
			ok(undefined),
		);
		release();
		expect(await first).toEqual(ok(undefined));
		expect(await read).toEqual(ok("one"));
		expect(await second).toEqual(ok(undefined));
		expect(await remove).toEqual(ok(undefined));
		expect(await records.read("p")).toEqual(ok(undefined));
	});
});
