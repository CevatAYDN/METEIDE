import { z } from "zod";
import { OAUTH_ERROR_BYTES, OAUTH_TOKEN_BYTES } from "../defaults.js";

const ErrorCode = z.object({
	error: z.enum([
		"invalid_request",
		"invalid_client",
		"invalid_grant",
		"unauthorized_client",
		"unsupported_grant_type",
		"invalid_scope",
		"access_denied",
		"server_error",
		"temporarily_unavailable",
		"invalid_dpop_proof",
		"use_dpop_nonce",
	]),
});
const bodyOf = async (response: Response, limit: number): Promise<unknown> => {
	const reader = response.body?.getReader();
	if (!reader) return undefined;
	const decoder = new TextDecoder();
	let size = 0;
	let text = "";
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > limit) return undefined;
			text += decoder.decode(part.value, { stream: true });
		}
		return JSON.parse(text + decoder.decode()) as unknown;
	} catch {
		return undefined;
	} finally {
		await reader.cancel().catch(() => undefined);
	}
};

const replaceBody = (response: Response, body: unknown) => {
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	headers.delete("content-encoding");
	headers.set("content-type", "application/json");
	return new Response(JSON.stringify(body), {
		status: response.status,
		headers,
	});
};

/** The SDK also logs OAuth errors returned with HTTP 200, before control returns. */
export const safeOAuthErrorResponse = async (
	response: Response,
	tokenResponse = false,
) => {
	if (response.status < 400 && !tokenResponse) return response;
	const body = await bodyOf(
		response,
		tokenResponse ? OAUTH_TOKEN_BYTES : OAUTH_ERROR_BYTES,
	);
	const error = ErrorCode.safeParse(body);
	const hasError =
		typeof body === "object" && body !== null && Object.hasOwn(body, "error");
	if (tokenResponse && response.ok && !hasError) {
		const { OAuthTokensSchema } = await import("@modelcontextprotocol/core");
		const tokens = OAuthTokensSchema.safeParse(body);
		if (tokens.success) return replaceBody(response, tokens.data);
	}
	return replaceBody(response, {
		error: error.success ? error.data.error : "server_error",
		error_description: "MCP authorization request failed",
	});
};
