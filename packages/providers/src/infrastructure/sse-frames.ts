// Event-stream framing for the `openai-chat` format (docs/09): some endpoints send the next
// `data:` line without the blank line that ends an event, which the SDK's parser joins into
// one unparsable event, so each `data:` line is made its own event.
// shortcut: assumes no endpoint splits one event's JSON over several data: lines (OpenAI-compatible
// ones send one per line); make it per endpoint if one does.

const DATA = "data:";

const separateDataLines = () => {
	let carry = "";
	let lastWasData = false;
	const line = (text: string, end: string) => {
		const isData = text.startsWith(DATA);
		const out = `${isData && lastWasData ? "\n" : ""}${text}${end}`;
		lastWasData = isData;
		return out;
	};
	return new TransformStream<string, string>({
		transform(text, out) {
			const lines = (carry + text).split("\n");
			carry = lines.pop() ?? "";
			out.enqueue(lines.map((l) => line(l, "\n")).join(""));
		},
		flush(out) {
			if (carry) out.enqueue(line(carry, ""));
		},
	});
};

/** A fetch whose event-stream answers have one event per `data:` line; other answers pass unchanged. */
export const separatedEvents =
	(fetch: typeof globalThis.fetch): typeof globalThis.fetch =>
	async (input, init) => {
		const res = await fetch(input, init);
		const type = res.headers.get("content-type") ?? "";
		if (!res.body || !type.includes("text/event-stream")) return res;
		const body = res.body
			.pipeThrough(new TextDecoderStream())
			.pipeThrough(separateDataLines())
			.pipeThrough(new TextEncoderStream());
		return new Response(body, {
			status: res.status,
			statusText: res.statusText,
			headers: res.headers,
		});
	};
