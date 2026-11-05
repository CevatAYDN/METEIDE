import { describe, expect, it } from "vitest";
import { cspFor, isOwnDocument } from "../src/application/csp.js";
import {
	type HeadersDetails,
	type HeadersResponse,
	installCsp,
} from "../src/application/csp-headers.js";

// The desktop's Content-Security-Policy (ADR-175): what the policy allows and refuses, and that the
// header installer touches only the app's own documents.

describe("cspFor", () => {
	const policy = cspFor();
	const directive = (name: string) =>
		policy
			.split("; ")
			.find((d) => d.startsWith(`${name} `))
			?.slice(name.length + 1);

	it("refuses remote scripts, objects, base tags and forms", () => {
		expect(directive("default-src")).toBe("'self'");
		expect(directive("script-src")).not.toContain("http");
		expect(directive("object-src")).toBe("'none'");
		expect(directive("base-uri")).toBe("'none'");
		expect(directive("form-action")).toBe("'none'");
	});

	it("allows what Monaco, Theia's workers and the local backend need", () => {
		expect(directive("style-src")).toContain("'unsafe-inline'");
		expect(directive("worker-src")).toContain("blob:");
		expect(directive("script-src")).toContain("'wasm-unsafe-eval'");
		expect(directive("connect-src")).toContain("ws://localhost:*");
		expect(directive("frame-src")).toContain("http://*.localhost:*");
	});
});

const DIR = "C:\\app\\lib\\frontend";

describe("isOwnDocument", () => {
	it("knows the frontend's pages on Windows and POSIX paths", () => {
		expect(
			isOwnDocument(
				"file:///C:/app/lib/frontend/index.html?port=1",
				DIR,
				"mainFrame",
			),
		).toBe(true);
		expect(
			isOwnDocument(
				"file:///home/u/app/lib/frontend/secondary-window.html",
				"/home/u/app/lib/frontend",
				"mainFrame",
			),
		).toBe(true);
	});

	it("leaves other responses alone", () => {
		expect(isOwnDocument("http://localhost:3000/", DIR, "mainFrame")).toBe(
			false,
		);
		expect(
			isOwnDocument("file:///C:/app/lib/frontend/bundle.js", DIR, "script"),
		).toBe(false);
		expect(isOwnDocument("file:///C:/other/index.html", DIR, "mainFrame")).toBe(
			false,
		);
	});
});

describe("installCsp", () => {
	const answers = (details: HeadersDetails) => {
		let listener:
			| ((d: HeadersDetails, cb: (r: HeadersResponse) => void) => void)
			| undefined;
		installCsp(
			{
				onHeadersReceived: (l) => {
					listener = l;
				},
			},
			DIR,
			"default-src 'self'",
		);
		let out: HeadersResponse | undefined;
		listener?.(details, (r) => {
			out = r;
		});
		return out;
	};

	it("adds the header to the app's own document and keeps the others", () => {
		expect(
			answers({
				url: "file:///C:/app/lib/frontend/index.html",
				resourceType: "mainFrame",
				responseHeaders: { "X-Other": ["1"] },
			}),
		).toEqual({
			responseHeaders: {
				"X-Other": ["1"],
				"Content-Security-Policy": ["default-src 'self'"],
			},
		});
	});

	it("leaves a foreign response's headers alone", () => {
		expect(
			answers({
				url: "http://localhost:3000/services",
				resourceType: "xhr",
				responseHeaders: { "X-Other": ["1"] },
			}),
		).toEqual({});
	});
});
