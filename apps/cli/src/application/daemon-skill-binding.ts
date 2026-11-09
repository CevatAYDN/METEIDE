import type { SkillError } from "@mete/contracts";
import type { CancellationToken, MessageConnection } from "vscode-jsonrpc/node";
import type { z } from "zod";

type Route<I, O> = {
	input: z.ZodType<I>;
	output: z.ZodType<O>;
	invoke: (input: I, signal: AbortSignal) => Promise<O>;
	failure: (code: SkillError["code"]) => O;
};

const invokeSkillRoute = async <I, O>(
	route: Route<I, O>,
	input: I,
	signal: AbortSignal,
): Promise<O> => {
	try {
		const output = await route.invoke(input, signal);
		const parsed = route.output.safeParse(output);
		return parsed.success ? parsed.data : route.failure("unavailable");
	} catch {
		return route.failure(signal.aborted ? "aborted" : "unavailable");
	}
};

const skillHandler =
	<I, O>(route: Route<I, O>, pending: Set<AbortController>) =>
	async (params: unknown, token: CancellationToken) => {
		const input = route.input.safeParse(params);
		if (!input.success) return route.failure("bad_input");
		const controller = new AbortController();
		if (token.isCancellationRequested) controller.abort();
		const subscription = token.onCancellationRequested(() =>
			controller.abort(),
		);
		pending.add(controller);
		try {
			return await invokeSkillRoute(route, input.data, controller.signal);
		} finally {
			subscription.dispose();
			pending.delete(controller);
		}
	};

/** Keep cancellation local to one request and abort pending work on daemon cleanup. */
export const skillBinding = (connection: MessageConnection) => {
	const pending = new Set<AbortController>();
	const registrations: { dispose(): void }[] = [];
	const bind = <I, O>(method: string, route: Route<I, O>) => {
		registrations.push(
			connection.onRequest(method, skillHandler(route, pending)),
		);
	};
	return {
		bind,
		dispose() {
			for (const controller of pending) controller.abort();
			for (const registration of registrations) registration.dispose();
		},
	};
};
