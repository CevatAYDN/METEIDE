import { describe, expect, it } from "vitest";
import {
	createKeychainStore,
	type KeychainEntry,
	keyringEntry,
} from "../../src/infrastructure/keychain.js";

// A fake keychain, so tests never touch the developer's real one.
const fakeKeychain = () => {
	const saved = new Map<string, string>();
	const opened: string[] = [];
	const entry = (service: string, account: string): KeychainEntry => {
		const key = `${service}/${account}`;
		opened.push(key);
		return {
			getPassword: async () => saved.get(key),
			setPassword: async (value) => {
				saved.set(key, value);
			},
			deleteCredential: async () => saved.delete(key),
		};
	};
	return { entry, opened };
};

const failing = (): KeychainEntry => {
	const fail = async (): Promise<never> => {
		throw new Error("keychain locked");
	};
	return { getPassword: fail, setPassword: fail, deleteCredential: fail };
};

describe("keychain store", () => {
	it("keeps secrets under service mete and the given account", async () => {
		const k = fakeKeychain();
		const store = createKeychainStore(k.entry);
		const name = "providers/nvidia/apiKey";
		expect(await store.get(name)).toEqual({ ok: true, value: undefined });
		expect(await store.set(name, "nvapi-1")).toEqual({
			ok: true,
			value: undefined,
		});
		expect(await store.get(name)).toEqual({ ok: true, value: "nvapi-1" });
		expect(await store.delete(name)).toEqual({ ok: true, value: true });
		expect(await store.delete(name)).toEqual({ ok: true, value: false });
		expect(new Set(k.opened)).toEqual(new Set([`mete/${name}`]));
	});

	it("returns secret_failed when the keychain fails, naming only the operation", async () => {
		const store = createKeychainStore(failing);
		for (const r of [
			await store.get("a"),
			await store.set("a", "value-that-must-not-leak"),
			await store.delete("a"),
		]) {
			expect(r.ok).toBe(false);
			if (!r.ok) {
				expect(r.error.code).toBe("secret_failed");
				expect(r.error.message).not.toContain("value-that-must-not-leak");
			}
		}
	});
});

// Linux needs a running Secret Service, which a CI box or WSL may not have.
describe.runIf(process.platform !== "linux")("real keychain", () => {
	it("writes, reads and deletes an entry under a throwaway service", async () => {
		const entry = keyringEntry(`mete-test-${crypto.randomUUID()}`, "probe");
		await entry.setPassword("probe-value");
		expect(await entry.getPassword()).toBe("probe-value");
		expect(await entry.deleteCredential()).toBe(true);
		expect(await entry.getPassword()).toBeUndefined();
	});
});
