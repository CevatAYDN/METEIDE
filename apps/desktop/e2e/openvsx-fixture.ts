import { createServer, type Server } from "node:http";

/** Synthetic catalog identity; no real extension or remote assets are used. */
export const OFFLINE_EXTENSION = {
	id: "mete-fixture.offline",
	query: "mete-offline-fixture",
	title: "METE Offline Fixture",
	description: "Synthetic extension for offline Electron regression tests.",
};

/** Backend HTTP evidence, including requests made before Playwright attaches. */
export type RegistryRequest = {
	readonly method: string;
	readonly path: string;
	readonly query: Readonly<Record<string, string>>;
};

/** An isolated loopback Open VSX service and its complete request log. */
export type OfflineRegistry = {
	readonly url: string;
	readonly requests: RegistryRequest[];
	readonly unexpected: RegistryRequest[];
	readonly close: () => Promise<void>;
};

const extensionData = (origin: string) => ({
	name: "offline",
	namespace: "mete-fixture",
	displayName: OFFLINE_EXTENSION.title,
	description: OFFLINE_EXTENSION.description,
	version: "1.0.0",
	timestamp: "2026-11-07T00:00:00.000Z",
	downloadCount: 0,
	url: `${origin}/api/mete-fixture/offline/1.0.0`,
	files: { download: `${origin}/fixture.vsix` },
	engines: { vscode: "*" },
});

const responseFor = (url: URL) => {
	const entry = extensionData(url.origin);
	if (url.pathname === "/api/-/search") {
		return {
			offset: 0,
			extensions:
				url.searchParams.get("query") === OFFLINE_EXTENSION.query
					? [{ ...entry, allVersions: [entry] }]
					: [],
		};
	}
	if (url.pathname !== "/api/v2/-/query") return undefined;
	const matches = url.searchParams.get("extensionId") === OFFLINE_EXTENSION.id;
	return {
		offset: 0,
		totalSize: matches ? 1 : 0,
		extensions: matches
			? [
					{
						...entry,
						namespaceUrl: `${url.origin}/api/mete-fixture`,
						reviewsUrl: `${entry.url}/reviews`,
						namespaceDisplayName: "METE Fixture",
						namespaceAccess: "public",
						preRelease: false,
						reviewCount: 0,
						allVersions: { "1.0.0": entry.url },
						publishedBy: { loginName: "mete-fixture" },
						verified: false,
					},
				]
			: [],
	};
};

const listen = async (server: Server) => {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Loopback registry has no TCP address");
	return `http://127.0.0.1:${address.port}`;
};

const close = (server: Server) =>
	new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
		server.closeAllConnections();
	});

/** Matches the installed 1.76 HTTP client; unknown routes fail closed, never proxy. */
export const startOfflineRegistry = async (): Promise<OfflineRegistry> => {
	const requests: RegistryRequest[] = [];
	const unexpected: RegistryRequest[] = [];
	let origin = "http://127.0.0.1";
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", origin);
		const recorded = {
			method: request.method ?? "",
			path: url.pathname,
			query: Object.fromEntries(url.searchParams),
		};
		requests.push(recorded);
		const body = request.method === "GET" ? responseFor(url) : undefined;
		if (!body) unexpected.push(recorded);
		response.writeHead(body ? 200 : 404, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		});
		response.end(
			JSON.stringify(body ?? { error: "Unexpected fixture request" }),
		);
	});
	origin = await listen(server);
	return {
		url: origin,
		requests,
		unexpected,
		close: () => close(server),
	};
};
