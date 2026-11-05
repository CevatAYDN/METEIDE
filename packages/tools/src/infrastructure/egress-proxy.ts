import {
	Agent,
	createServer,
	type IncomingMessage,
	request,
	type ServerResponse,
} from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
	type Lookup,
	resolvePublicAddress,
} from "../application/host-check.js";

type Destination = { readonly host: string; readonly port: number };
type OpenSocket = (target: Destination) => Socket;
type EgressDeps = {
	readonly lookup: Lookup;
	readonly local: URL | undefined;
	readonly open: OpenSocket;
	readonly tunnels: Set<Duplex>;
};

/** Serves a per-run loopback proxy that pins HTTP and HTTPS destinations to validated DNS results. */
export const egressProxy = async (
	lookup: Lookup,
	localOrigin?: string,
	open: OpenSocket = socket,
) => {
	const local = localOrigin ? new URL(localOrigin) : undefined;
	const tunnels = new Set<Duplex>();
	const deps = { lookup, local, open, tunnels };
	const server = createServer(
		(req, res) => void forward(req, res, deps).catch(() => fail(res)),
	);
	server.on(
		"connect",
		(req, client, head) =>
			void tunnel(req, client, head, deps).catch(() => client.destroy()),
	);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => close(server, tunnels),
	};
};

const socket: OpenSocket = ({ host, port }) => connect({ host, port });

const destination = async (
	deps: EgressDeps,
	target: Destination,
	allowLocal = false,
): Promise<Destination> => {
	if (
		allowLocal &&
		deps.local?.protocol === "http:" &&
		deps.local.port &&
		target.host === deps.local.hostname &&
		Number(deps.local.port) === target.port
	)
		return { ...target, host: "127.0.0.1" };
	const answer = await resolvePublicAddress(deps.lookup, target.host);
	if (!answer.ok) throw new Error(answer.error.message);
	return { ...target, host: answer.value };
};

const forward = async (
	req: IncomingMessage,
	res: ServerResponse,
	deps: EgressDeps,
) => {
	if (!req.method || !/^[A-Z]+$/.test(req.method)) return fail(res);
	const url = new URL(req.url ?? "", `http://${req.headers.host ?? ""}`);
	if (url.protocol !== "http:" || url.username || url.password)
		return fail(res);
	const target = await destination(
		deps,
		{
			host: url.hostname,
			port: Number(url.port || 80),
		},
		true,
	);
	const upstream = openRequest(url, req, target, deps.open);
	upstream.once("response", (answer) => {
		res.writeHead(answer.statusCode ?? 502, answer.headers);
		answer.pipe(res);
	});
	upstream.once("error", () => fail(res));
	req.once("aborted", () => upstream.destroy());
	res.once("close", () => upstream.destroy());
	req.pipe(upstream);
};

const openRequest = (
	url: URL,
	req: IncomingMessage,
	target: Destination,
	open: OpenSocket,
) => {
	const agent = new (class extends Agent {
		override createConnection() {
			return open(target);
		}
	})();
	const upstream = request(url, {
		method: req.method,
		headers: { ...req.headers, host: url.host },
		agent,
	});
	upstream.once("response", (res) => res.once("close", () => agent.destroy()));
	upstream.once("error", () => agent.destroy());
	return upstream;
};

const tunnel = async (
	req: IncomingMessage,
	client: Duplex,
	head: Buffer,
	deps: EgressDeps,
) => {
	const target = connectTarget(req.url ?? "");
	const address = await destination(deps, target);
	const upstream = deps.open(address);
	pipeTunnel(upstream, client, head, deps.tunnels);
};

const connectTarget = (value: string): Destination => {
	let target: URL;
	try {
		target = new URL(`http://${value}`);
	} catch {
		throw new Error("invalid CONNECT target");
	}
	const port = Number(target.port);
	if (
		!target.hostname ||
		target.pathname !== "/" ||
		target.username ||
		target.password ||
		!Number.isInteger(port) ||
		port < 1 ||
		port > 65_535
	)
		throw new Error("invalid CONNECT target");
	return { host: target.hostname, port };
};

const pipeTunnel = (
	upstream: Socket,
	client: Duplex,
	head: Buffer,
	tunnels: Set<Duplex>,
) => {
	tunnels.add(upstream);
	tunnels.add(client);
	upstream.once("close", () => tunnels.delete(upstream));
	client.once("close", () => tunnels.delete(client));
	upstream.once("connect", () => {
		client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
		if (head.length) upstream.write(head);
		client.pipe(upstream);
		upstream.pipe(client);
	});
	upstream.once("error", () => client.destroy());
	client.once("error", () => upstream.destroy());
};

const close = (server: ReturnType<typeof createServer>, tunnels: Set<Duplex>) =>
	new Promise<void>((resolve) => {
		server.closeAllConnections();
		for (const stream of tunnels) stream.destroy();
		server.close(() => resolve());
	});

const fail = (res: ServerResponse) => {
	if (!res.headersSent) res.writeHead(502);
	res.end();
};
