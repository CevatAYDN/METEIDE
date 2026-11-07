/** Identical uncertain payloads reuse a UUID; edits and successful sends retire it (ADR-182). */
export const createSendIntent = () => {
	const intents = new Map<string, { payload: string; requestId: string }>();
	return {
		for: (scope: string, input: object): string => {
			const payload = JSON.stringify(input);
			const previous = intents.get(scope);
			if (previous?.payload === payload) return previous.requestId;
			const requestId = crypto.randomUUID();
			intents.set(scope, { payload, requestId });
			return requestId;
		},
		clear: (scope: string) => {
			intents.delete(scope);
		},
	};
};
