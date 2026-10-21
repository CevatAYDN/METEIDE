import { isIPv4, isIPv6 } from "node:net";

// web.fetch@1 reaches the public web only (SECURITY.md, threats): local names and loopback,
// private, link-local, shared and unspecified addresses are refused. Pure.
// shortcut: literal hosts only; a public name that resolves to a private address (DNS
// rebinding) is not caught; check resolved addresses when an allow list for local hosts comes.

const LOCAL_NAMES = /(^|\.)(localhost|local|internal|home\.arpa)$/;

const privateV4 = (ip: string) => {
	const [a = 0, b = 0] = ip.split(".").map(Number);
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168)
	);
};

const privateV6 = (ip: string) => {
	const v = ip.toLowerCase();
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)?.[1];
	if (mapped) return privateV4(mapped);
	// URL writes a mapped IPv4 address in hex: ::ffff:7f00:1 is 127.0.0.1.
	const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
	if (hex) {
		const hi = Number.parseInt(hex[1] ?? "0", 16);
		const lo = Number.parseInt(hex[2] ?? "0", 16);
		return privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
	}
	return (
		v === "::" ||
		v === "::1" ||
		/^f[cd]/.test(v) ||
		/^fe[89ab]/.test(v) ||
		v.startsWith("ff")
	);
};

/** Whether a URL host may be fetched: a public name or a public address. */
export const isPublicHost = (hostname: string) => {
	const host = hostname
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/\.$/, "");
	if (host === "" || LOCAL_NAMES.test(host)) return false;
	if (isIPv4(host)) return !privateV4(host);
	if (isIPv6(host)) return !privateV6(host);
	return true;
};
