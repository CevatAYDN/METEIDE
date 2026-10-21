import { describe, expect, it } from "vitest";
import { isPublicHost } from "../../src/domain/addresses.js";

describe("isPublicHost", () => {
	it.each([
		"example.com",
		"8.8.8.8",
		"100.128.0.1",
		"172.32.0.1",
		"[2606:4700::1111]",
	])("lets %s through", (host) => {
		expect(isPublicHost(host)).toBe(true);
	});

	it.each([
		"localhost",
		"api.localhost",
		"printer.local",
		"LOCALHOST.",
		"127.0.0.1",
		"10.1.2.3",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"[::1]",
		"[::]",
		"[fd00::1]",
		"[fe80::1]",
		"[::ffff:127.0.0.1]",
		new URL("http://[::ffff:127.0.0.1]/").hostname,
		new URL("http://2130706433/").hostname,
	])("refuses %s", (host) => {
		expect(isPublicHost(host)).toBe(false);
	});
});
