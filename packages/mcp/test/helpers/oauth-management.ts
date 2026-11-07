import { z } from "zod";

/** Fully scripted HTTPS adapter; only the separate callback uses real loopback HTTP. */
export const oauthManagementServer = () => {
	const root = "https://management.example";
	const seen = { registration: 0, exchange: 0 };
	const token = "offline-management-access-token";
	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	const metadata = {
		issuer: root,
		authorization_endpoint: `${root}/authorize`,
		token_endpoint: `${root}/token`,
		registration_endpoint: `${root}/register`,
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code", "refresh_token"],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["none"],
	};
	const message = z.object({
		id: z.union([z.number(), z.string()]).optional(),
		method: z.string(),
	});
	const grant = (form: URLSearchParams) =>
		form.get("code") === "offline-code" ||
		form.get("refresh_token") === "offline-refresh"
			? json({
					access_token: token,
					refresh_token: "offline-refresh",
					token_type: "Bearer",
				})
			: json({ error: "invalid_grant" }, 400);
	const rpcResult = (method: string) =>
		method === "initialize"
			? {
					protocolVersion: "2025-11-25",
					capabilities: { tools: {} },
					serverInfo: { name: "fixture", version: "1" },
				}
			: { tools: [] };
	const oauth = async (request: Request): Promise<Response | undefined> => {
		const path = new URL(request.url).pathname;
		if (path.includes(".well-known/oauth-protected-resource"))
			return json({ resource: `${root}/mcp`, authorization_servers: [root] });
		if (path.includes(".well-known/oauth-authorization-server"))
			return json(metadata);
		if (path === "/register") {
			seen.registration++;
			const body = z
				.record(z.string(), z.unknown())
				.parse(await request.json());
			return json({ ...body, client_id: "offline-public-client" }, 201);
		}
		if (path === "/token") {
			seen.exchange++;
			const form = new URLSearchParams(await request.text());
			return grant(form);
		}
		return undefined;
	};
	const answer = async (request: Request): Promise<Response> => {
		const authorization = await oauth(request);
		if (authorization) return authorization;
		if (new URL(request.url).pathname !== "/mcp")
			return new Response("", { status: 404 });
		if (request.headers.get("authorization") !== `Bearer ${token}`)
			return new Response("", {
				status: 401,
				headers: {
					"WWW-Authenticate": `Bearer resource_metadata="${root}/.well-known/oauth-protected-resource"`,
				},
			});
		if (request.method !== "POST") return new Response("", { status: 405 });
		const rpc = message.parse(await request.json());
		if (rpc.id === undefined) return new Response(null, { status: 202 });
		const result = rpcResult(rpc.method);
		return json({ jsonrpc: "2.0", id: rpc.id, result });
	};
	const fake: typeof fetch = (input, init) => answer(new Request(input, init));
	return { root, seen, token, fetch: fake };
};
