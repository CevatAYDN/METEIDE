import { Agent, createServer as createHttpServer, get } from "node:http";
import {
	connect,
	createServer as createTcpServer,
	type Socket,
} from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { egressProxy } from "../../src/infrastructure/egress-proxy.js";
import { pinnedLookup } from "../../src/infrastructure/pinned-fetch.js";

const servers: Array<{ close: () => void }> = [];
const tcpServers: Array<{ close: () => void }> = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.close();
	for (const server of tcpServers.splice(0)) server.close();
});

const listen = async (server: ReturnType<typeof createHttpServer>) => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	servers.push(server);
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no address");
	return address.port;
};

const lookup = async (hostname: string): Promise<readonly string[]> => {
	if (hostname === "mixed.example") return ["93.184.216.34", "127.0.0.1"];
	return ["93.184.216.34"];
};

describe("DNS-pinned outbound connections", () => {
	it("returns only validated addresses to Node's socket lookup callback", async () => {
		const resolve = (hostname: string) =>
			new Promise<{ address: string; family: number }>((done, fail) =>
				pinnedLookup(lookup)(hostname, {}, (error, address, family) => {
					if (error) fail(error);
					else done({ address: String(address), family: family ?? 0 });
				}),
			);
		expect(await resolve("public.example")).toEqual({
			address: "93.184.216.34",
			family: 4,
		});
		await expect(resolve("mixed.example")).rejects.toMatchObject({
			code: "EACCES",
		});
	});

	it("connects HTTP through the validated address, not the hostname", async () => {
		const upstream = createHttpServer((req, res) => res.end(req.headers.host));
		const upstreamPort = await listen(upstream);
		const destinations: string[] = [];
		const proxy = await egressProxy(lookup, undefined, (target) => {
			destinations.push(target.host);
			return connect({ host: "127.0.0.1", port: upstreamPort });
		});
		servers.push({ close: () => void proxy.close() });
		const body = await new Promise<string>((resolve, reject) => {
			get(
				new URL("http://public.example/page"),
				{
					agent: new Agent({ proxyEnv: { HTTP_PROXY: proxy.url } }),
				},
				(res) => {
					res.setEncoding("utf8");
					let text = "";
					res.on("data", (chunk: string) => (text += chunk));
					res.on("end", () => resolve(text));
				},
			).on("error", reject);
		});
		expect(body).toBe("public.example");
		expect(destinations).toEqual(["93.184.216.34"]);
	});

	it("pins HTTPS CONNECT and refuses a private DNS answer", async () => {
		let localPort = 0;
		const upstream = createTcpServer((socket) => socket.pipe(socket));
		await new Promise<void>((resolve) =>
			upstream.listen(0, "127.0.0.1", resolve),
		);
		const bound = upstream.address();
		if (!bound || typeof bound === "string") throw new Error("no address");
		localPort = bound.port;
		tcpServers.push(upstream);
		const destinations: string[] = [];
		const proxy = await egressProxy(lookup, undefined, (target) => {
			destinations.push(target.host);
			return connect({ host: "127.0.0.1", port: localPort });
		});
		servers.push({ close: () => void proxy.close() });
		const socket: Socket = connect({
			port: Number(new URL(proxy.url).port),
			host: "127.0.0.1",
		});
		const reply = new Promise<string>((resolve) => {
			let text = "";
			socket.on("data", (chunk) => {
				text += chunk.toString();
				if (text.includes("pong")) resolve(text);
			});
		});
		socket.write(
			"CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\n",
		);
		await new Promise<void>((resolve) => socket.once("data", () => resolve()));
		socket.write("pong");
		expect(await reply).toContain("pong");
		expect(destinations).toEqual(["93.184.216.34"]);
		socket.destroy();

		const denied = await egressProxy(lookup);
		servers.push({ close: () => void denied.close() });
		await expect(
			new Promise<void>((resolve, reject) => {
				get(
					new URL("http://mixed.example/"),
					{
						agent: new Agent({ proxyEnv: { HTTP_PROXY: denied.url } }),
					},
					(res) => {
						res.resume();
						res.statusCode === 502
							? resolve()
							: reject(new Error("not blocked"));
					},
				).on("error", reject);
			}),
		).resolves.toBeUndefined();
	});
});
